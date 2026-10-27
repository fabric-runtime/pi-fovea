import {afterEach,describe,expect,it,vi} from 'vitest';
import type {C,E,Law,Machine} from 'gdp-wired/machine';
import type {Goal,Tree} from 'gdp-wired/kernel';
import {check,obligations} from 'gdp-wired/kernel';
import {cellProducts} from 'gdp-wired/prove';
import * as interval from '../src/core/interval.js';
import {besselBounds} from '../src/core/numerics.js';
interface Group {name:string;machine?:Machine;laws:Law[];from?:string;inputs?:boolean;using?:string[];supports?:Record<string,string[]>;}
const {series,seriesFamilies,seriesProofs,seriesLaws,seriesLawNames}=await vi.importActual<{
  series:{machine:Machine};seriesFamilies:{machine:Machine};seriesProofs:Group[];seriesLaws:Law[];seriesLawNames:string[];
}>('../proofs/series.mjs');
const {checkProofGroups}=await vi.importActual<{checkProofGroups:(groups:Group[])=>number}>('../scripts/check-streams.mjs');
const {provePolynomial}=await vi.importActual<{provePolynomial:(goal:Goal,until:number)=>Tree|undefined}>('../scripts/prove-polynomial.mjs');
type Values=Record<string,bigint>;
// Independent exact execution of the model's expression tree, not its Number runtime.
function expr(e:E,v:Values):bigint{
  switch(e.op){
    case 'const':return BigInt(e.value);
    case 'var':return v[e.name]!;
    case 'add':return expr(e.a,v)+expr(e.b,v);
    case 'sub':{const d=expr(e.a,v)-expr(e.b,v);return d<0n?0n:d;}
    case 'mul':return BigInt(e.k)*expr(e.a,v);
    case 'prod':return expr(e.a,v)*expr(e.b,v);
    case 'if':return expr(condition(e.c,v)?e.then:e.else,v);
    default:throw new Error(`Unsupported model expression ${e.op}`);
  }
}
function condition(c:C,v:Values):boolean{
  switch(c.op){
    case '<':return expr(c.a,v)<expr(c.b,v);
    case '<=':return expr(c.a,v)<=expr(c.b,v);
    case '=':return expr(c.a,v)===expr(c.b,v);
    case 'and':return c.xs.every(x=>condition(x,v));
    case 'or':return c.xs.some(x=>condition(x,v));
    case 'not':return !condition(c.x,v);
    default:throw new Error(`Unsupported model condition ${c.op}`);
  }
}
const evaluate=(expressions:Record<string,E>,values:Values):Values=>Object.fromEntries(Object.entries(expressions).map(([k,e])=>[k,expr(e,values)]));
afterEach(()=>vi.restoreAllMocks());
describe('constructive series certificates',()=>{
  it('has a unique inventory including unbounded future-prefix Cauchy convergence',()=>{
    expect(new Set(seriesLawNames).size).toBe(seriesLawNames.length);
    expect(seriesLawNames).toContain('series_all_future_prefixes_cauchy');
    expect(seriesLawNames).toContain('series_bessel_cutoff_exists');
    expect(checkProofGroups([])).toBe(0);
  });
  it('encloses exact finite sums and every tested future prefix without Number arithmetic',()=>{
    for(const n of [0n,1n,3n])for(const initial of [0n,1n,4n]){
      const p={n,gap:2n,initial,precision:2n},d=n+p.gap;
      let s=evaluate(series.machine.state,p),product=1n,power=1n,expectedNum=0n,expectedDen=1n;
      const threshold=p.precision*d*d*initial;
      for(let k=0;k<Number(threshold)+12;k++){
        // Independently add the next rational term by common denominators.
        expectedNum=expectedNum*product+initial*power*expectedDen;expectedDen*=product;
        const growth=BigInt(k%5),factor=d+growth;
        const checkpoint=BigInt(BigInt(k)===threshold||k===1);
        s=evaluate(series.machine.step.state!,{...p,...s,growth,checkpoint});
        product*=factor;power*=n;
        expect(s.term).toBe(initial*power);expect(s.denominator).toBe(product);
        expect(s.sum!*expectedDen).toBe(expectedNum*product);
        for(const law of seriesLaws)expect(condition(law.holds,{...p,...s}),law.name).toBe(true);
        if(s.savedIndex!>=threshold){
          expect(p.precision*s.sum!*s.savedDenominator!).toBeLessThanOrEqual(p.precision*s.savedSum!*s.denominator!+s.denominator!*s.savedDenominator!);
        }
      }
    }
  });
  it('instantiates exponential and Bessel tail denominators beyond the safe-integer range',()=>{
    const p={numerator:2n**60n+7n,denominator:2n**63n+1n,start:97n,index:123n,order:512n};
    const s=evaluate(seriesFamilies.machine.state,p);
    expect(s.expBase!+s.expGrowth!).toBe(p.denominator*(p.start+p.index+1n));
    expect(s.besselBase!+s.besselGrowth!).toBe(4n*p.denominator**2n*(p.start+p.index+1n)*(p.start+p.index+p.order+1n));
    expect(s.expCutoff).toBeGreaterThan(p.numerator);
    expect(s.besselCutoff).toBeGreaterThan(p.numerator**2n);
  });
  it('rejects unknown supports, circular premises and input-dependent consequences',()=>{
    const m=series.machine,l={name:'truth',holds:{op:'=',a:{op:'const',value:0},b:{op:'const',value:0}}} satisfies Law;
    expect(()=>checkProofGroups([{name:'bad',machine:m,laws:[l],supports:{truth:['invented']}}])).toThrow('unknown support');
    const base:Group={name:'base',machine:m,laws:[]};
    expect(()=>checkProofGroups([base,{name:'circular',from:'base',using:['circular'],laws:[]}])).toThrow('inadmissible prior consequence');
    const input:Group={name:'input',from:'base',inputs:true,laws:[]};
    expect(()=>checkProofGroups([base,input,{name:'escaped',from:'base',using:['input'],laws:[]}])).toThrow('inadmissible prior consequence');
  });
  it('checks polynomial trees independently and rejects a fabricated leaf and a false law',()=>{
    const law=seriesLaws.find(x=>x.name==='series_checkpoint_conservation')!;
    const goal=obligations(series.machine,[law]).find(g=>g.name.endsWith('@step'))!;
    const before=cellProducts.on;cellProducts.on=true;
    try{
      const tree=provePolynomial(goal,performance.now()+3000);
      expect(tree).toBeDefined();expect(check(goal,tree!)).toBe(true);
      const broken=structuredClone(tree!);let leaf=broken;while('split' in leaf)leaf=leaf.yes;leaf.leaf=[];
      expect(check(goal,broken)).toBe(false);
      const x:E={op:'var',name:'x'};
      const falseGoal:Goal={name:'false square',hyps:[{op:'not',x:{op:'=',a:{op:'prod',a:x,b:x},b:x}}]};
      expect(provePolynomial(falseGoal,performance.now()+200)).toBeUndefined();
      expect(provePolynomial(goal,performance.now()-1)).toBeUndefined();
    }finally{cellProducts.on=before;}
  });
  it('routes scalar series through the common geometric tail bound',()=>{
    const tail=vi.spyOn(interval,'geometricTail');
    const value=besselBounds(1,0.125137);
    expect(tail).toHaveBeenCalled();expect(value.lower).toBeGreaterThan(0);expect(value.upper).toBeGreaterThanOrEqual(value.lower);
  });
});
