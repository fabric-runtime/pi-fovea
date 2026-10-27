// Coefficients of (P-I)^n as a signed pair, with Q(j)=j mod 2 built
// by the same checked stream. These are formal coefficients, not floats.
import {fold,nat,when,forall,Term} from 'gdp-wired';
import {pascal,pascalLaws,pascalSupport} from './operators.mjs';
const coefficient=(e,k,negative)=>when(k.atMost(e.row).and(e.Q.at(e.row.minus(k)).eq(negative?1:0)),e.B.at(k),0);
export const pascalSteps=[false,true].map(negative=>pascal.stepLaw(
  negative?'poisson_negative_coefficient_step':'poisson_positive_coefficient_step',
  (a,b)=>forall(k=>coefficient(b,k,negative).eq(
    when(k.gt(0),coefficient(a,k.minus(1),negative),0).plus(coefficient(a,k,!negative)))),
  e=>e.ready.eq(1)));

// A normalized branching tree models arbitrary finite stochastic paths.
// Its leaves carry signed mass; internal weights sum to their denominator.
// Numerators share an exact denominator. No division or IEEE arithmetic.
export const stochastic=fold('normalized_stochastic_paths').params({mass:nat})
  .inputs({positive:nat,negative:nat,left:nat,right:nat,divisor:nat})
  .assume(e=>e.positive.plus(e.negative).eq(e.mass).and(e.left.plus(e.right).eq(e.divisor),e.divisor.gt(0)))
  .leaf(e=>({posNum:e.positive,negNum:e.negative,denominator:1}))
  .node((e,a,b)=>({
    posNum:e.left.mul(a.posNum).mul(b.denominator).plus(e.right.mul(b.posNum).mul(a.denominator)),
    negNum:e.left.mul(a.negNum).mul(b.denominator).plus(e.right.mul(b.negNum).mul(a.denominator)),
    denominator:e.divisor.mul(a.denominator).mul(b.denominator),
  }));
export const stochasticLaws=[
  stochastic.law('stochastic_path_denominator_positive',e=>e.denominator.gt(0)),
  stochastic.law('stochastic_path_mass',e=>e.posNum.plus(e.negNum).eq(e.mass.mul(e.denominator))),
  stochastic.law('stochastic_path_variation_contraction',e=>e.posNum.minus(e.negNum).plus(e.negNum.minus(e.posNum)).atMost(e.mass.mul(e.denominator))),
];
// These are proof search hints, never additional assumptions. All universally
// quantified instances come from this same checked invariant group.
const term=name=>new Term({op:'var',name});
function coefficientInstances(law){
  const row=term('row'),k=law.forall?term(law.forall+'#'):undefined;
  if(law.name==='pascal_factorial_coefficient')return {
    pascal_indices:[k.e],pascal_factorial_adjacent:[k.e],pascal_complement_adjacent:[k.e],
    pascal_factorial_coefficient:[k.e,k.minus(1).e],
  };
  const keys=[{op:'const',value:0},row.e,...(k?[k.e,k.minus(1).e]:[])];
  return Object.fromEntries(pascalLaws.filter(l=>l.forall).map(l=>[l.name,keys]));
}
function signedInstances(law){
  const row=term('row'),k=term(law.forall);
  return {pascal_parity_bit:[row.minus(k).e,row.minus(k.minus(1)).e],
    pascal_parity_adjacent:[row.minus(k).e],pascal_coefficients_supported:[k.e]};
}
export const operatorProofs=[
  {name:'pascal_coefficients',machine:pascal.machine,laws:pascalLaws,polynomial:true,
    supports:Object.fromEntries(pascalLaws.map(l=>[l.name,[...new Set(['pascal_ready_bit',...(pascalSupport[l.name]??[])])] ])),
    instances:coefficientInstances,search:law=>law.name==='pascal_factorial_coefficient'
      ?{ms:8000,nodes:128,products:3500,rows:7000,closureRounds:1}:{}},
  {name:'signed_coefficients',from:'pascal_coefficients',steps:true,laws:pascalSteps,polynomial:true,
    supports:Object.fromEntries(pascalSteps.map(l=>[l.name,['pascal_ready_bit','pascal_parity_zero','pascal_parity_bit',
      'pascal_parity_adjacent','pascal_coefficients_supported','pascal_first_coefficient','pascal_last_coefficient']])),
    instances:signedInstances},
  {name:'stochastic_paths',fold:stochastic.fold,laws:stochasticLaws,polynomial:true},
];
export const operatorLawNames=operatorProofs.flatMap(p=>p.laws.map(l=>l.name));
