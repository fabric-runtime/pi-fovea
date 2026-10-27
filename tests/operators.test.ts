import {describe,expect,it,vi} from 'vitest';
import type {C,E,Law,Machine} from 'gdp-wired/machine';
import type {Fold,Goal,StepLaw,Tree} from 'gdp-wired/kernel';
import {check,obligations} from 'gdp-wired/kernel';
interface Group {
  name:string;machine?:Machine;fold?:Fold;laws:(Law|StepLaw)[];from?:string;steps?:boolean;using?:string[];
  supports?:Record<string,string[]>;instances?:(law:Law|StepLaw)=>Record<string,E[]>;
  search?:(law:Law|StepLaw)=>Record<string,number>;polynomial?:boolean;
}
const {pascal,pascalLaws}=await vi.importActual<{pascal:{machine:Machine};pascalLaws:Law[]}>('../proofs/operators.mjs');
const {operatorProofs,operatorLawNames,stochastic,stochasticLaws}=await vi.importActual<{
  operatorProofs:Group[];operatorLawNames:string[];stochastic:{fold:Fold};stochasticLaws:Law[];
}>('../proofs/operator-steps.mjs');
const {checkProofGroups}=await vi.importActual<{checkProofGroups:(groups:Group[])=>number}>('../scripts/check-streams.mjs');
const {provePolynomial}=await vi.importActual<{provePolynomial:(goal:Goal,until:number,trace?:unknown,options?:Record<string,number>)=>Tree|undefined}>('../scripts/prove-polynomial.mjs');
type Values=Record<string,bigint>;
interface Frame {values:Values;maps:Record<string,Map<bigint,bigint>>;defaults:Values;}
function expression(e:E,f:Frame):bigint{
  switch(e.op){
    case 'const':return BigInt(e.value);
    case 'var':{const v=f.values[e.name];if(v===undefined)throw new Error(`Unbound ${e.name}`);return v;}
    case 'add':return expression(e.a,f)+expression(e.b,f);
    case 'sub':{const d=expression(e.a,f)-expression(e.b,f);return d<0n?0n:d;}
    case 'mul':return BigInt(e.k)*expression(e.a,f);
    case 'prod':return expression(e.a,f)*expression(e.b,f);
    case 'get':return f.maps[e.map]!.get(expression(e.key,f))??f.defaults[e.map]!;
    case 'if':return expression(condition(e.c,f)?e.then:e.else,f);
    default:throw new Error(`Unsupported expression ${e.op}`);
  }
}
function condition(c:C,f:Frame):boolean{
  switch(c.op){
    case '<':return expression(c.a,f)<expression(c.b,f);
    case '<=':return expression(c.a,f)<=expression(c.b,f);
    case '=':return expression(c.a,f)===expression(c.b,f);
    case 'not':return !condition(c.x,f);
    case 'and':return c.xs.every(x=>condition(x,f));
    case 'or':return c.xs.some(x=>condition(x,f));
    default:throw new Error(`Unsupported condition ${c.op}`);
  }
}
const fields=(es:Record<string,E>,f:Frame):Values=>Object.fromEntries(Object.entries(es).map(([key,e])=>[key,expression(e,f)]));
function initial(m:Machine):Frame{
  const defaults=Object.fromEntries(Object.entries(m.maps??{}).map(([key,n])=>[key,BigInt(n)]));
  const f:Frame={values:{},maps:Object.fromEntries(Object.keys(defaults).map(key=>[key,new Map()])),defaults};
  return {...f,values:fields(m.state,f)};
}
function step(m:Machine,f:Frame,width:number):Frame{
  const maps={...f.maps};
  for(const [name,update] of Object.entries(m.step.maps??{})){
    const cells=new Map(f.maps[name]);
    if('each' in update){
      for(let k=0;k<width;k++)cells.set(BigInt(k),expression(update.value,{...f,values:{...f.values,[update.each]:BigInt(k)}}));
    }else cells.set(expression(update.key,f),expression(update.value,f));
    maps[name]=cells;
  }
  return {...f,values:fields(m.step.state??{},f),maps};
}
const cell=(f:Frame,name:string,k:number)=>f.maps[name]!.get(BigInt(k))??f.defaults[name]!;
const factorial=(n:number)=>{let out=1n;for(let i=2;i<=n;i++)out*=BigInt(i);return out;};
const signed=(f:Frame,k:number)=>k>Number(f.values.row)?0n:cell(f,'B',k)*(cell(f,'Q',Number(f.values.row)-k)===0n?1n:-1n);

describe('constructive operator coefficients',()=>{
  it('registers unbounded coefficients, signed transitions and stochastic paths',()=>{
    expect(operatorLawNames).toHaveLength(24);
    expect(new Set(operatorLawNames).size).toBe(operatorLawNames.length);
    expect(operatorLawNames).toContain('pascal_factorial_coefficient');
    expect(operatorLawNames).toContain('poisson_negative_coefficient_step');
    expect(operatorLawNames).toContain('stochastic_path_variation_contraction');
  });
  it('matches independent factorial and polynomial oracles past safe-integer arithmetic',()=>{
    let f=step(pascal.machine,initial(pascal.machine),36);
    let binomial=[1n],polynomial=[1n];
    for(let n=0;n<=32;n++){
      expect(f.values.row).toBe(BigInt(n));expect(f.values.factorial).toBe(factorial(n));
      for(let k=0;k<36;k++){
        expect(cell(f,'B',k)).toBe(binomial[k]??0n);expect(signed(f,k)).toBe(polynomial[k]??0n);
        if(k<=n){
          expect(cell(f,'K',k)).toBe(factorial(k));expect(cell(f,'R',k)).toBe(factorial(n-k));
          expect(cell(f,'Q',k)).toBe(BigInt(k%2));
          expect(cell(f,'B',k)*factorial(k)*factorial(n-k)).toBe(factorial(n));
        }
        for(const law of pascalLaws){
          const at=law.forall?{...f,values:{...f.values,[law.forall]:BigInt(k)}}:f;
          expect(condition(law.holds,at),`${law.name} at (${n},${k})`).toBe(true);
        }
      }
      binomial=Array.from({length:n+2},(_,k)=>(binomial[k]??0n)+(binomial[k-1]??0n));
      polynomial=Array.from({length:n+2},(_,k)=>(polynomial[k-1]??0n)-(polynomial[k]??0n));
      f=step(pascal.machine,f,36);
    }
    expect(f.values.factorial).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });
  it('executes arbitrary-depth normalized path witnesses exactly',()=>{
    const fold=stochastic.fold,mass=2n**60n+3n;
    const run=(depth:number,seed:number):Values=>{
      const positive=BigInt(seed%3)*(mass/3n),inputs={mass,positive,negative:mass-positive,left:BigInt(seed%5),right:5n-BigInt(seed%5),divisor:5n};
      const f:Frame={values:inputs,maps:{},defaults:{}};expect(condition(fold.assume!,f)).toBe(true);
      let result:Values;
      if(depth===0)result=fields(fold.leaf,f);
      else{
        const left=run(depth-1,seed+1),right=run(depth-1,seed+4);
        result=fields(fold.node,{...f,values:{...inputs,...Object.fromEntries(Object.entries(left).map(([k,v])=>['l_'+k,v])),...Object.fromEntries(Object.entries(right).map(([k,v])=>['r_'+k,v]))}});
        expect(result.posNum!*5n*left.denominator!*right.denominator!).toBe((inputs.left*left.posNum!*right.denominator!+inputs.right*right.posNum!*left.denominator!)*result.denominator!);
      }
      for(const law of stochasticLaws)expect(condition(law.holds,{...f,values:{mass,...result}}),law.name).toBe(true);
      return result;
    };
    const result=run(5,3);expect(result.denominator).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });
  it('checks the coefficient certificate independently and refuses corruption',()=>{
    const group=operatorProofs[0]!,law=pascalLaws.find(l=>l.name==='pascal_factorial_coefficient')!;
    const supports=group.supports![law.name]!.map(name=>pascalLaws.find(l=>l.name===name)!);
    const goal=obligations(pascal.machine,[law,...supports],{[law.name]:group.instances!(law)},0).find(g=>g.name.endsWith('@step'))!;
    const search=group.search!(law);
    const tree=provePolynomial(goal,performance.now()+(search.ms??4000),undefined,search);
    expect(tree).toBeDefined();expect(check(goal,tree!)).toBe(true);
    const broken=structuredClone(tree!);let leaf=broken;while('split' in leaf)leaf=leaf.yes;leaf.leaf=[];
    expect(check(goal,broken)).toBe(false);
  });
  it('rejects broken rows and missing normalization, not just mismatched receipts',()=>{
    const bad=structuredClone(pascal.machine);bad.step.maps!.B={each:'k',value:{op:'const',value:0}};
    expect(()=>checkProofGroups([{...operatorProofs[0]!,machine:bad}])).toThrow('pascal_first_coefficient');
    const fold=structuredClone(stochastic.fold);
    expect(fold.assume!.op).toBe('and');
    if(fold.assume!.op==='and')fold.assume={op:'and',xs:[fold.assume!.xs[0]!,fold.assume!.xs[2]!]};
    expect(()=>checkProofGroups([{...operatorProofs[2]!,fold}])).toThrow('stochastic_path_mass');
  });
  it('never promotes a step law to an invariant assumption',()=>{
    const base:Group={name:'base',machine:pascal.machine,laws:[]};
    expect(()=>checkProofGroups([{...base,fold:stochastic.fold}])).toThrow('incompatible proof modes');
    const transition:Group={name:'transition',from:'base',steps:true,laws:[]};
    expect(()=>checkProofGroups([base,transition,{name:'escape',from:'base',using:['transition'],laws:[]}])).toThrow('inadmissible prior consequence');
  });
});
