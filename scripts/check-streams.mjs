import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obligations, loopObligations, foldObligations, stepLawObligations, sideGoals, check } from 'gdp-wired/kernel';
import { grow, cellProducts } from 'gdp-wired/prove';
import { streamProofs } from '../proofs/streams.mjs';
import { provePolynomial } from './prove-polynomial.mjs';

// A support list can only remove hypotheses. Invariant supports belong to the
// same mutually inductive group; derived supports must already be proved.
const supportFor=(proof,claim,available)=>{
  const names=proof.supports?.[claim.name];
  if(!names)return available;
  const selected=names.map(name=>{
    const found=available.find(l=>l.name===name);
    if(!found)throw new Error(`${claim.name}: unknown support ${name}`);
    return found;
  });
  return selected;
};
export function checkProofGroups(proofs,{ms=15000}={}){
  if(!Number.isFinite(ms)||ms<=0)throw new Error('Positive finite proof deadline required');
  const previous=cellProducts.on,deadline=performance.now()+ms;cellProducts.on=true;
  try {
    const proved=new Map();let count=0;
    for(const proof of proofs){
      if([proof.machine,proof.fold,proof.loop,proof.from].filter(Boolean).length!==1||proof.steps&&!proof.from)
        throw new Error(`${proof.name}: incompatible proof modes`);
      if(proved.has(proof.name))throw new Error(`${proof.name}: duplicate proof group`);
      if(proof.from&&!proved.has(proof.from))throw new Error(`${proof.name}: missing proved invariant group`);
      const basis=proved.get(proof.from);
      if(proof.from&&(!basis.machine||basis.from||basis.loop||basis.fold||basis.steps))throw new Error(`${proof.name}: expected a checked invariant group`);
      const available=basis?[...basis.laws]:proof.laws;
      for(const name of proof.using??[]){
        const prior=proved.get(name);
        if(!basis||!prior||prior.from!==proof.from||prior.inputs||prior.steps)throw new Error(`${proof.name}: inadmissible prior consequence ${name}`);
        available.push(...prior.laws);
      }
      const goals=proof.steps?proof.laws.flatMap(l=>stepLawObligations(basis.machine,supportFor(proof,l,available),proof.instances?.(l)??{},l)):
        proof.fold?foldObligations(proof.fold,proof.laws):proof.from?proof.laws.map(l=>({name:l.name,hyps:[...(basis.machine.pre?[basis.machine.pre]:[]),
        ...supportFor(proof,l,available).map(x=>x.holds),...(proof.inputs&&basis.machine.assume?[basis.machine.assume]:[]),{op:'not',x:l.holds}]})):
        proof.loop?loopObligations(proof.loop,proof.laws,proof.rank):proof.supports||proof.instances?[
          ...proof.laws.flatMap(l=>obligations(proof.machine,[l,...supportFor(proof,l,proof.laws).filter(x=>x!==l)],{[l.name]:proof.instances?.(l)??{}},0)),
          ...sideGoals(proof.machine),
        ]:obligations(proof.machine,proof.laws);
      for(const goal of goals){
        const claim=proof.laws.find(l=>goal.name===l.name||goal.name.startsWith(l.name+' @'));
        const search=proof.search?.(claim)??{};
        const until=Math.min(deadline,performance.now()+(search.ms??4000));
        const usePolynomial=Array.isArray(proof.polynomial)?proof.polynomial.some(name=>goal.name===name||goal.name.startsWith(name+' @')):!!proof.polynomial;
        const polynomial=usePolynomial?provePolynomial(goal,until,undefined,search):undefined;
        const result=usePolynomial?(polynomial?{tree:polynomial}:{stuck:'polynomial search budget or capability'}):grow(goal,undefined,{nodes:20000,until});
        if(!('tree' in result)||!check(goal,result.tree))
          throw new Error(`${goal.name}: proof refused ${JSON.stringify('tree' in result?{checked:false}:result)}`);
      }
      proved.set(proof.name,proof);count+=proof.loop?1:proof.laws.length;
    }
    return count;
  } finally {cellProducts.on=previous;}
}
export const checkStreams=(proofs=streamProofs)=>checkProofGroups(proofs);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    if(process.argv.length!==2)throw new Error('usage: node scripts/check-streams.mjs');
    console.log(`${checkStreams()} arithmetic stream claims proved and checked; no Lean loaded`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
