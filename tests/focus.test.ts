import {describe,expect,it,vi} from 'vitest';
import type {Law,Machine} from 'gdp-wired/machine';
import type {StepLaw} from 'gdp-wired/kernel';
import {exactMachine,type Frame} from './helpers/natural-machine.js';
interface Group {name:string;machine?:Machine;from?:string;laws:(Law|StepLaw)[];}
const {focus,focusLaws,focusProofs,focusLawNames}=await vi.importActual<{
  focus:{machine:Machine};focusLaws:Law[];focusProofs:Group[];focusLawNames:string[];
}>('../proofs/focus.mjs');
const {checkProofGroups}=await vi.importActual<{checkProofGroups:(groups:Group[])=>number}>('../scripts/check-streams.mjs');
const runner=exactMachine(focus.machine,focusLaws),abs=(x:bigint)=>x<0n?-x:x;
const norm=(v:bigint[])=>v.reduce((a,b)=>abs(b)>a?abs(b):a,0n);
const step=(f:Frame,action:number,at=0,weight=0n,magnitude=0n,negative=false)=>runner.advance(f,{action:BigInt(action),at:BigInt(at),weight,magnitude,negative:negative?1n:0n});
function vector(f:Frame):bigint[]{
  const prefix=f.v.phase===0n?'A':'B';
  return Array.from({length:Number(f.v.size)},(_,k)=>(f.maps[prefix+'.p']!.get(BigInt(k))??0n)-(f.maps[prefix+'.n']!.get(BigInt(k))??0n));
}
describe('indexed focus and the infinity norm',()=>{
  it('checks every row with an arbitrary exact input bound',()=>{
    expect(focusLawNames).toHaveLength(19);expect(focusLawNames).toContain('focus_global_linf_bound');
    expect(focusLawNames).toContain('focus_round_covers_rows');
    let values=[2n**60n+7n,-(2n**60n+5n),3n,-11n],f=runner.initial({divisor:3n,size:4n,inputBound:norm(values)});
    const rows:[[number,bigint][],[number,bigint][],[number,bigint][],[number,bigint][]]=[
      [[0,1n],[1,1n],[2,1n]],[[0,2n],[2,1n]],[[1,3n]],[[3,3n]],
    ];
    const initialNorm=norm(values);
    for(const [i,v] of values.entries())f=step(f,0,i,0n,abs(v),v<0n);
    for(let round=1;round<=8;round++){
      const expected=rows.map(row=>row.reduce((sum,[j,w])=>sum+w*values[j]!,0n));
      for(let i=0;i<rows.length;i++){
        f=step(f,1);
        for(const [j,w] of rows[i]!){const source=vector(f);f=step(f,2,j,w);expect(vector(f)).toEqual(source);}
        f=step(f,3);expect(f.v.cursor).toBe(BigInt(i+1));
      }
      f=step(f,4);values=expected;expect(vector(f)).toEqual(expected);
      expect(f.v.round).toBe(BigInt(round));expect(f.v.denominator).toBe(3n**BigInt(round));
      expect(norm(values)).toBeLessThanOrEqual(initialNorm*f.v.denominator!);
    }
  });
  it('blocks overweight rows, premature commits/rollover and invalid seed coordinates',()=>{
    let f=runner.initial({divisor:3n,size:2n,inputBound:9n});
    f=step(f,0,2,0n,9n);f=step(f,0,0,0n,10n);expect(vector(f)).toEqual([0n,0n]);
    f=step(f,0,0,0n,9n,true);f=step(f,4);expect(f.v.round).toBe(0n);
    f=step(f,1);f=step(f,2,0,4n);expect(f.v.remaining).toBe(3n);expect(f.v.pendingN).toBe(0n);
    f=step(f,3);expect(f.v.cursor).toBe(0n);f=step(f,2,0,3n);f=step(f,3);
    f=step(f,4);expect(f.v.round).toBe(0n);expect(f.v.cursor).toBe(1n);
    f=step(f,0,1,0n,9n);expect(vector(f)).toEqual([-9n,0n]);
  });
  it('supports empty vectors and repeated isolated identity rows',()=>{
    let empty=runner.initial({divisor:7n,size:0n,inputBound:0n});for(let i=0;i<5;i++)empty=step(empty,4);
    expect(empty.v.round).toBe(5n);expect(vector(empty)).toEqual([]);
    let f=runner.initial({divisor:1n,size:1n,inputBound:5n});f=step(f,0,0,0n,5n,true);
    for(let i=0;i<5;i++){f=step(f,1);f=step(f,2,0,1n);f=step(f,3);f=step(f,4);}
    expect(vector(f)).toEqual([-5n]);expect(f.v.denominator).toBe(1n);
  });
  it('rejects a removed weight guard and a skipped-row rollover in the kernel',()=>{
    for(const [flag,name] of [['gather','focus_weight_consumed'],['flip','focus_round_covers_rows']] as const){
      const bad=structuredClone(focus.machine),c=bad.step.flags![flag]!;if(c.op!=='and')throw new Error('Expected conjunctive guard');
      bad.step.flags![flag]={op:'and',xs:c.xs.slice(0,-1)};
      const group=focusProofs.at(-1)!,law=group.laws.find(l=>l.name===name)!;
      expect(()=>checkProofGroups([{name:'broken',machine:bad,laws:[]},{...group,from:'broken',laws:[law]}])).toThrow(name);
    }
  });
});
