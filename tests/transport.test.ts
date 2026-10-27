import {describe,expect,it,vi} from 'vitest';
import type {C,E,Law,Machine} from 'gdp-wired/machine';
import type {StepLaw} from 'gdp-wired/kernel';
interface Group {name:string;machine?:Machine;from?:string;laws:(Law|StepLaw)[];supports?:Record<string,string[]>;}
interface Frame {v:Record<string,bigint>;maps:Record<string,Map<bigint,bigint>>;flags:Record<string,boolean>;}
const {transport,transportLaws,transportLawNames,transportProofs}=await vi.importActual<{
  transport:{withSumsOf:(...laws:Law[])=>{machine:Machine}};transportLaws:Law[];transportLawNames:string[];transportProofs:Group[];
}>('../proofs/transport.mjs');
const {checkProofGroups}=await vi.importActual<{checkProofGroups:(groups:Group[],options?:{ms:number})=>number}>('../scripts/check-streams.mjs');
const model=transport.withSumsOf(...transportLaws).machine;
function expr(e:E,f:Frame):bigint{
  switch(e.op){
    case 'const':return BigInt(e.value);
    case 'var':{const v=f.v[e.name];if(v===undefined)throw new Error(`Unknown ${e.name}`);return v;}
    case 'get':return f.maps[e.map]!.get(expr(e.key,f))??0n;
    case 'add':return expr(e.a,f)+expr(e.b,f);
    case 'sub':{const d=expr(e.a,f)-expr(e.b,f);return d<0n?0n:d;}
    case 'mul':return BigInt(e.k)*expr(e.a,f);
    case 'prod':return expr(e.a,f)*expr(e.b,f);
    case 'if':return expr(cond(e.c,f)?e.then:e.else,f);
    default:throw new Error(`Unhandled ${e.op}`);
  }
}
function cond(c:C,f:Frame):boolean{
  switch(c.op){
    case '=':return expr(c.a,f)===expr(c.b,f);
    case '<':return expr(c.a,f)<expr(c.b,f);
    case '<=':return expr(c.a,f)<=expr(c.b,f);
    case 'and':return c.xs.every(x=>cond(x,f));
    case 'or':return c.xs.some(x=>cond(x,f));
    case 'not':return !cond(c.x,f);
    case 'flag':return f.flags[c.name]!;
    default:throw new Error(`Unhandled ${c.op}`);
  }
}
// Compute sums directly from finite maps, not from the prover's ghost counters.
function sums(f:Frame):Frame{
  const keys=new Set(Object.values(f.maps).flatMap(m=>[...m.keys()]));
  for(const [name,s] of Object.entries(model.sums??{})){
    f.v[name]=[...keys].reduce((total,k)=>total+expr(s.term,{...f,v:{...f.v,[s.key]:k}}),0n);
  }
  return f;
}
function initial(divisor=3n):Frame{
  const f:Frame={v:{divisor},maps:Object.fromEntries(Object.keys(model.maps??{}).map(k=>[k,new Map()])),flags:{}};
  for(const [k,e] of Object.entries(model.state))f.v[k]=expr(e,f);
  return sums(f);
}
function step(f:Frame,action:number,at=0,magnitude=0n,negative=false,weight=0n):Frame{
  const before=sums({...f,v:{...f.v,action:BigInt(action),at:BigInt(at),magnitude,negative:negative?1n:0n,weight},flags:{}});
  for(const [name,c] of Object.entries(model.step.flags??{}))before.flags[name]=cond(c,before);
  const maps=Object.fromEntries(Object.entries(before.maps).map(([name,cells])=>[name,new Map(cells)]));
  for(const [name,w] of Object.entries(model.step.maps??{})){
    if('each' in w)throw new Error('Transport must use explicit point writes');
    maps[name]!.set(expr(w.key,before),expr(w.value,before));
  }
  const after=sums({v:{divisor:f.v.divisor!,...Object.fromEntries(Object.entries(model.step.state??{}).map(([k,e])=>[k,expr(e,before)]))},maps,flags:{}});
  const keys=new Set([0n,1n,2n,65539n,...Object.values(maps).flatMap(m=>[...m.keys()])]);
  for(const l of transportLaws){
    for(const k of l.forall?keys:[0n])expect(cond(l.holds,{...after,v:{...after.v,...(l.forall?{[l.forall]:k}:{})}}),l.name).toBe(true);
  }
  return after;
}
const magnitude=(x:bigint)=>x<0n?-x:x;
const norm=(v:Map<number,bigint>)=>[...v.values()].reduce((sum,x)=>sum+magnitude(x),0n);
function current(f:Frame):Map<number,bigint>{
  const name=f.v.phase===0n?'A':'B',out=new Map<number,bigint>();
  for(const k of new Set([...f.maps[name+'.p']!.keys(),...f.maps[name+'.n']!.keys()])){
    const p=f.maps[name+'.p']!.get(k)??0n,n=f.maps[name+'.n']!.get(k)??0n;
    expect(p===0n||n===0n).toBe(true);if(p!==n)out.set(Number(k),p-n);
  }
  return out;
}
describe('indexed rational transport',()=>{
  it('declares global L1 contraction, not just a scalar path bound',()=>{
    expect(transportLawNames).toHaveLength(14);expect(new Set(transportLawNames).size).toBe(14);
    expect(transportLawNames).toContain('transport_global_l1_bound');
    expect(Object.keys(model.sums??{})).toHaveLength(2);
  });
  it('matches independent sparse matrix powers with signs, cancellation and an isolate',()=>{
    let expected=new Map([[0,2n**60n+3n],[1,-(2n**60n+1n)],[2,7n],[65539,-11n]]),f=initial();
    for(const [k,v] of expected)f=step(f,0,k,magnitude(v),v<0n);
    const initialNorm=norm(expected);
    const columns=new Map<number,[number,bigint][]>([[0,[[0,1n],[1,1n],[2,1n]]],[1,[[0,2n],[2,1n]]],[2,[[1,3n]]],[65539,[[65539,3n]]]]);
    for(let round=1;round<=8;round++){
      const next=new Map<number,bigint>();
      for(const [origin,value] of expected){
        f=step(f,1,origin);
        for(const [dest,weight] of columns.get(origin)!){
          f=step(f,2,dest,0n,false,weight);next.set(dest,(next.get(dest)??0n)+weight*value);
        }
      }
      expected=new Map([...next].filter(([,v])=>v!==0n));f=step(f,3);
      expect(current(f)).toEqual(expected);expect(f.v.round).toBe(BigInt(round));expect(f.v.denominator).toBe(3n**BigInt(round));
      expect(norm(current(f))).toBeLessThanOrEqual(initialNorm*f.v.denominator!);
    }
  });
  it('refuses overdraw, premature completion and seeding after activation',()=>{
    let f=step(initial(),0,1,9n,true);expect(current(step(f,3))).toEqual(current(f));
    f=step(f,1,1);const before=f;
    f=step(f,2,2,0n,false,4n);expect(f.v.remaining).toBe(3n);
    for(const name of Object.keys(f.maps))for(const k of new Set([...f.maps[name]!.keys(),...before.maps[name]!.keys()]))
      expect(f.maps[name]!.get(k)??0n).toBe(before.maps[name]!.get(k)??0n);
    f=step(f,0,4,100n);expect(current(f).has(4)).toBe(false);
    expect(step(f,3).v.round).toBe(0n);f=step(f,2,2,0n,false,3n);f=step(f,3);
    expect(current(f)).toEqual(new Map([[2,-27n]]));expect(f.v.denominator).toBe(3n);
  });
  it('rejects a broken weight-budget transition in the kernel',()=>{
    const bad=structuredClone(model),emit=bad.step.flags!.emit!;
    expect(emit.op).toBe('and');
    if(emit.op!=='and')throw new Error('Expected explicit weight guard');
    expect(emit.xs.at(-1)!.op).toBe('<=');
    bad.step.flags!.emit={op:'and',xs:emit.xs.slice(0,-1)};
    const stepGroup=transportProofs.at(-1)!,law=stepGroup.laws.find(l=>l.name==='transport_weight_consumed')!;
    expect(()=>checkProofGroups([{name:'broken',machine:bad,laws:[]},{...stepGroup,from:'broken',laws:[law]}])).toThrow('transport_weight_consumed');
    expect(()=>checkProofGroups([],{ms:NaN})).toThrow('Positive finite proof deadline');
  });
  it('preserves the empty vector through arbitrary finite completed rounds',()=>{
    let f=initial(7n);
    for(let i=0;i<12;i++){f=step(f,1,100);f=step(f,2,100,0n,false,7n);f=step(f,3);}
    expect(current(f).size).toBe(0);expect(f.v.initialNorm).toBe(0n);expect(f.v.round).toBe(12n);
  });
});
