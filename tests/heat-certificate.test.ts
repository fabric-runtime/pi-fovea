import { describe, expect, it } from 'vitest';
import { certifyHeat } from '../src/core/heat-certificate.js';
import { buildCsr, focusField, forwardHeat, type Csr } from '../src/core/heat.js';
import type { Graph } from '../src/core/types.js';
const graph=(n:number,edges:Array<[number,number,number]>):Graph=>({nodes:Array.from({length:n},(_,i)=>({id:`n${i}`,name:`n${i}`,kind:'function',file:'f',line:i,sig:'',lang:'ts'})),edges:edges.map(([a,b,w])=>({a,b,w,kind:'invokes'})),byName:new Map(),byFile:new Map(),anchors:[],files:[]});
const pair=(weight=1):Csr=>buildCsr(graph(3,[[0,1,weight]]));
describe('end-to-end u32 interval heat certificates',()=>{
  it('encloses analytic two-node heat, signs and isolates across the time domain',()=>{
    const source=new Float64Array([1,-0.25,3]);
    for(const time of [0,0.5,4,64])for(const mode of ['forward','focus'] as const){
      const c=certifyHeat(pair(),source,time,{mode});
      const d=0.625*Math.exp(-2*time),exact=[0.375+d,0.375-d,3];
      expect(c.withinTolerance).toBe(true);expect(c.poissonOrder).toBeLessThan(512);
      for(let i=0;i<3;i++){expect(c.lower[i]).toBeLessThanOrEqual(exact[i]!);expect(c.upper[i]).toBeGreaterThanOrEqual(exact[i]!);}
      expect(c.remainderBound).toBeLessThanOrEqual(1e-10/8);expect(c.work).toBeLessThanOrEqual(100000);
    }
  });
  it('bounds real solver outputs on irregular graphs without assuming the stored degree sum is exact',()=>{
    const csr=buildCsr(graph(6,[[0,1,0.1],[1,2,2],[2,3,1.25],[3,4,3],[4,0,0.3]])),source=new Float64Array([1,0,0.25,0,1,0.1]);
    for(const time of [0.5,8,64])for(const mode of ['forward','focus'] as const){
      const c=certifyHeat(csr,source,time,{mode,absoluteTolerance:1e-8});
      const candidate=(mode==='forward'?forwardHeat:focusField)(csr,source,time);
      expect(c.value).toEqual(candidate);expect(c.withinTolerance).toBe(true);
      for(let i=0;i<source.length;i++)expect(Math.abs(candidate[i]!-(c.lower[i]!+c.upper[i]!)/2)).toBeLessThanOrEqual(c.maxAbsoluteError);
    }
  });
  it('refuses to certify corrupted recurrence/output or normalization',()=>{
    const csr=pair(),source=new Float64Array([1,0,0]);
    const c=certifyHeat(csr,source,1,{candidate:new Float64Array([10,0,0])});
    expect(c.withinTolerance).toBe(false);expect(c.maxAbsoluteError).toBeGreaterThan(9);
    csr.deg[0]=16;
    expect(certifyHeat(csr,source,1).withinTolerance).toBe(false);
  });
  it('normalizes subnormal and huge weights in exact power-of-two coordinates',()=>{
    for(const weight of [Number.MIN_VALUE,Number.MAX_VALUE]){
      const d=0.5*Math.exp(-2),candidate=new Float64Array([0.5+d,0.5-d,0]);
      const c=certifyHeat(pair(weight),new Float64Array([1,0,0]),1,{candidate});
      expect(c.withinTolerance).toBe(true);expect(c.lower[0]).toBeLessThanOrEqual(candidate[0]!);expect(c.upper[0]).toBeGreaterThanOrEqual(candidate[0]!);
    }
  });
  it('encloses a mixed smallest/largest dyadic row without rounding weights before normalization',()=>{
    const csr:Csr={n:3,rowPtr:new Uint32Array([0,2,2,2]),col:new Uint32Array([1,2]),
      w:new Float64Array([Number.MAX_VALUE,Number.MIN_VALUE]),deg:new Float64Array([Number.MAX_VALUE,0,0])};
    for(const mode of ['forward','focus'] as const){
      const decay=Math.exp(-1),candidate=new Float64Array(mode==='forward'?[decay,1-decay,0]:[decay,0,0]);
      const result=certifyHeat(csr,new Float64Array([1,0,0]),1,{mode,candidate});
      expect(result.withinTolerance).toBe(true);
      for(let i=0;i<3;i++){expect(result.lower[i]).toBeLessThanOrEqual(candidate[i]!);expect(result.upper[i]).toBeGreaterThanOrEqual(candidate[i]!);}
    }
  });
  it('fails closed on invalid CSR, nonfinite data, work exhaustion and unattainable precision',()=>{
    const source=new Float64Array([1,0,0]);
    expect(()=>certifyHeat(pair(),source,1,{maxWork:4})).toThrow(/budget|cap/);
    expect(()=>certifyHeat(pair(),source,1,{absoluteTolerance:1e-100})).toThrow(/precision/);
    expect(()=>certifyHeat(pair(),source,65)).toThrow();
    expect(()=>certifyHeat(pair(),source,1,{candidate:new Float64Array([NaN,0,0])})).toThrow();
    const bad=pair();bad.col[0]=99;expect(()=>certifyHeat(bad,source,1)).toThrow(/edge/);
    const invalid=pair();invalid.w[0]=-1;expect(()=>certifyHeat(invalid,source,1)).toThrow(/edge/);
    const rows=pair();rows.rowPtr[1]=99;expect(()=>certifyHeat(rows,source,1)).toThrow();
  });
});
