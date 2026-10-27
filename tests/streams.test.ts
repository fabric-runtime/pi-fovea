import { describe, expect, it, vi, afterEach } from 'vitest';
import * as generated from '../src/verified/generated/streams.js';
import { addWords, subtractWords, multiplyWords, divideSmall, compareWords } from '../src/core/u32.js';
import type { Compiled } from 'gdp-wired/machine';
import { cellProducts } from 'gdp-wired/prove';
const {checkStreams}=await vi.importActual<{checkStreams:(proofs:unknown[])=>number}>('../scripts/check-streams.mjs');
const {streams}=await vi.importActual<{streams:Record<'add32'|'multiply16'|'divide16',{rule:{compiled():Compiled}}>} >('../proofs/streams.mjs');
const value=(digits:Uint32Array,bits=32)=>Array.from(digits).reduceRight((a,x)=>(a<<BigInt(bits))+BigInt(x),0n);
afterEach(()=>vi.restoreAllMocks());
describe('executed arbitrary-length arithmetic streams',()=>{
  it('routes production arithmetic through the generated complete digit streams',()=>{
    expect(addWords).toBe(generated.addWordArrays);expect(subtractWords).toBe(generated.subtractWordArrays);
    expect(divideSmall).toBe(generated.divideArraySmall);expect(compareWords).toBe(generated.compareWordArrays);
    const m=vi.spyOn(generated,'multiplyAddRow');
    const x=Uint32Array.of(0xffffffff,0xffffffff),y=Uint32Array.of(7);
    expect(value(addWords(x,y))).toBe(value(x)+7n);
    expect(value(subtractWords(x,y))).toBe(value(x)-7n);
    expect(value(multiplyWords(x,y))).toBe(value(x)*7n);expect(m).toHaveBeenCalled();
    expect(value(divideSmall(x,7).quotient)).toBe(value(x)/7n);
  });
  it('handles long carry/borrow chains and leading-zero padding without mutating inputs',()=>{
    const x=new Uint32Array(4096).fill(0xffffffff),saved=x.slice();
    const sum=generated.addWordArrays(x,Uint32Array.of(1));
    expect(sum.length).toBe(4097);expect(sum[4096]).toBe(1);expect(sum.subarray(0,4096).every(x=>x===0)).toBe(true);
    expect(generated.subtractWordArrays(sum,Uint32Array.of(1))).toEqual(saved);
    expect(x).toEqual(saved);
    expect(compareWords(Uint32Array.of(7,0,0),Uint32Array.of(7))).toBe(0);
    expect(compareWords(Uint32Array.of(0,1),Uint32Array.of(0xffffffff))).toBe(1);
    expect(generated.addWordArrays(new Uint32Array(10),new Uint32Array())).toEqual(new Uint32Array());
    expect(()=>generated.subtractWordArrays(Uint32Array.of(1),Uint32Array.of(2))).toThrow(RangeError);
  });
  it('reconstructs whole multiply-add rows, including the final carry',()=>{
    let seed=42;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed&65535;};
    for(let n=0;n<64;n++){
      const a=Uint32Array.from({length:n},next),b=Uint32Array.from({length:n},next),factor=next();
      expect(value(generated.multiplyAddRow(factor,a,b),16)).toBe(BigInt(factor)*value(a,16)+value(b,16));
    }
  });
  it('refuses invalid multiply/divide witnesses and stops instead of making progress',()=>{
    const m=streams.multiply16.rule.compiled(),mp={count:1,factor:3};
    const bad=m.step(mp,m.init(mp),{a:2,b:0,low:7,high:0}).scalars;
    expect(bad).toMatchObject({done:1,error:1,pos:0,carry:0});
    const d=streams.divide16.rule.compiled(),dp={count:1,divisor:3};
    expect(d.step(dp,d.init(dp),{digit:7,quotient:2,remainder:2}).scalars).toMatchObject({done:1,error:1,pos:0,carry:0});
  });
  it('keeps completed machines stable and bounds their actual executed scalar state',()=>{
    const r=streams.add32.rule.compiled(),p={count:2};let s=r.init(p);
    for(let i=0;i<3;i++){s=r.step(p,s,{a:0xffffffff,b:0xffffffff});expect(Object.values(s.scalars).every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff)).toBe(true);}
    expect(r.step(p,s,{a:1,b:1})).toEqual(s);
    expect(Object.keys(s.scalars)).not.toContain('power');expect(Object.keys(s.scalars)).not.toContain('left');
  });
  it('refuses unproved corollary premises and restores prover configuration on failure',()=>{
    const before=cellProducts.on;
    expect(()=>checkStreams([{name:'orphan',from:'unproved',laws:[]}])).toThrow('missing proved invariant group');
    expect(cellProducts.on).toBe(before);
  });
  it('checks machine preconditions at the runtime codec, before allocation or arithmetic',()=>{
    const empty=new Uint32Array();
    for(const factor of [-1,0.5,65536,NaN,Infinity])expect(()=>generated.multiplyAddRow(factor,empty,empty)).toThrow(RangeError);
    for(const divisor of [0,-1,0.5,2**32,NaN,Infinity])expect(()=>generated.divideArraySmall(empty,divisor)).toThrow(RangeError);
    expect(()=>generated.multiplyAddRow(1,Uint32Array.of(1),empty)).toThrow(RangeError);
    expect(()=>generated.addWordArrays([] as unknown as Uint32Array,empty)).toThrow(TypeError);
    const enormous=new Uint32Array();Object.defineProperty(enormous,'length',{value:2**32});
    expect(()=>generated.addWordArrays(enormous,empty)).toThrow(RangeError);
  });
});
