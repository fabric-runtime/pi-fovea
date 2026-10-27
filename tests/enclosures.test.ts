import {describe,expect,it,vi} from 'vitest';
import type {Law,Machine,E} from 'gdp-wired/machine';
import {condition,type Frame} from './helpers/natural-machine.js';
interface Group {name:string;machine:Machine;laws:Law[];}
const {enclosure,quotient,enclosureProofs,enclosureLaws,quotientLaws}=await vi.importActual<{
  enclosure:{machine:Machine};quotient:{machine:Machine};enclosureProofs:Group[];enclosureLaws:Law[];quotientLaws:Law[];
}>('../proofs/enclosures.mjs');
const {checkProofGroups}=await vi.importActual<{checkProofGroups:(groups:Group[])=>number}>('../scripts/check-streams.mjs');
const frame=(v:Record<string,bigint>):Frame=>({v,maps:{},flags:{}});
describe('ported exact interval policies',()=>{
  it('proves all seven contracts and refuses reversed multiplication and truncated ceilings',()=>{
    expect(checkProofGroups(enclosureProofs)).toBe(7);
    const variable=(name:string):E=>({op:'var',name});
    const product=(a:string,b:string):E=>({op:'prod',a:variable(a),b:variable(b)});
    const badProduct:Law={...enclosureLaws[1]!,holds:{op:'<=',a:product('au','bu'),b:product('a','b')}};
    expect(()=>checkProofGroups([{...enclosureProofs[1]!,laws:[badProduct]}])).toThrow(badProduct.name);
    const badCeil:Law={...quotientLaws[1]!,holds:{op:'<=',a:variable('n'),b:product('d','q')}};
    expect(()=>checkProofGroups([{...enclosureProofs[0]!,laws:[badCeil]}])).toThrow(badCeil.name);
  });
  it('matches floor and ceiling oracles beyond safe-integer arithmetic',()=>{
    for(const d of [1n,3n,65537n])for(const q of [0n,1n,2n**70n])for(const r of new Set([0n,d-1n])){
      const n=d*q+r,f=frame({d,q,r,n});expect(condition(quotient.machine.pre!,f)).toBe(true);
      for(const law of quotientLaws)expect(condition(law.holds,f),law.name).toBe(true);
      expect(n/d).toBe(q);expect((n+d-1n)/d).toBe(q+(r===0n?0n:1n));
    }
  });
  it('checks signed differences and certificate distances with independently computed endpoints',()=>{
    for(const offset of [0n,2n**65n]){
      const al=offset,a=offset+2n,au=offset+5n,bl=1n,b=3n,bu=7n,candidate=offset+3n,epsilon=3n;
      const f=frame({al,a,au,bl,b,bu,candidate,epsilon});expect(condition(enclosure.machine.pre!,f)).toBe(true);
      for(const law of enclosureLaws)expect(condition(law.holds,f),law.name).toBe(true);
      expect(al-bu<=a-b&&a-b<=au-bl).toBe(true);expect(candidate-a<=epsilon&&a-candidate<=epsilon).toBe(true);
    }
  });
});
