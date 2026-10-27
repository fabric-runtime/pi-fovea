// Constructive positive-series enclosures over exact natural fractions.
// At k: lower=sum/denominator, upper=lower+d*term/(gap*denominator).
// d=n+gap; each successive ratio is n/(d+growth), growth >= 0.
// Values are proof-only, never compiled into bounded JS arithmetic.
import {rule,nat,bool,when,Term} from 'gdp-wired';
const t=name=>new Term({op:'var',name});
const law=(name,condition)=>({name,holds:condition.c});
export const series=rule('positive_series').params({n:nat,gap:nat,initial:nat,precision:nat})
  .pre(e=>e.gap.gt(0)).inputs({growth:nat,checkpoint:bool})
  .state({index:0,denominator:1,term:e=>e.initial,sum:0,
    savedIndex:0,savedDenominator:1,savedTerm:e=>e.initial,savedSum:0,
    tailSlack:0,rateSlack:0,windowSlack:0,lowerSlack:0,savedRateSlack:0})
  .step(e=>{const d=e.n.plus(e.gap),divisor=d.plus(e.growth);return {
    tailSlack:e.tailSlack.mul(divisor).plus(e.n.mul(e.growth).mul(e.term)),
    rateSlack:e.rateSlack.mul(divisor).plus(e.term.mul(e.gap.mul(e.gap).mul(e.index.plus(1)).plus(e.growth.mul(d.plus(e.index.mul(e.gap)))))),
    windowSlack:when(e.checkpoint,0,e.windowSlack).mul(divisor).plus(e.n.mul(e.growth).mul(e.term).mul(when(e.checkpoint,e.denominator,e.savedDenominator))),
    savedRateSlack:when(e.checkpoint,e.rateSlack,e.savedRateSlack),
    lowerSlack:when(e.checkpoint,0,e.lowerSlack).mul(divisor).plus(e.term.mul(divisor).mul(when(e.checkpoint,e.denominator,e.savedDenominator))),
    index:e.index.plus(1),denominator:e.denominator.mul(divisor),term:e.term.mul(e.n),sum:e.sum.plus(e.term).mul(divisor),
    savedIndex:when(e.checkpoint,e.index,e.savedIndex),savedDenominator:when(e.checkpoint,e.denominator,e.savedDenominator),
    savedTerm:when(e.checkpoint,e.term,e.savedTerm),savedSum:when(e.checkpoint,e.sum,e.savedSum),
  };});
const d=t('n').plus(t('gap')),gap=t('gap'),den=t('denominator'),term=t('term'),sum=t('sum');
const sd=t('savedDenominator'),st=t('savedTerm'),ss=t('savedSum');
const threshold=t('precision').mul(d).mul(d).mul(t('initial'));
export const seriesLaws=[
  series.law('series_denominator_positive',e=>e.denominator.gt(0)),
  law('series_tail_conservation',gap.mul(sum).plus(d.mul(term)).plus(t('tailSlack')).eq(d.mul(t('initial')).mul(den))),
  law('series_rate_conservation',d.plus(t('index').mul(gap)).mul(term).plus(t('rateSlack')).eq(d.mul(t('initial')).mul(den))),
  law('series_checkpoint_denominator_positive',sd.gt(0)),
  law('series_checkpoint_rate_conservation',d.plus(t('savedIndex').mul(gap)).mul(st).plus(t('savedRateSlack')).eq(d.mul(t('initial')).mul(sd))),
  law('series_checkpoint_index_bound',t('savedIndex').atMost(t('index'))),
  law('series_checkpoint_lower_conservation',sum.mul(sd).eq(ss.mul(den).plus(t('lowerSlack')))),
  law('series_checkpoint_conservation',gap.mul(sum).plus(d.mul(term)).mul(sd).plus(t('windowSlack')).eq(gap.mul(ss).plus(d.mul(st)).mul(den))),
];
const after=Object.fromEntries(Object.entries(series.machine.step.state).map(([key,value])=>[key,new Term(value)]));
export const seriesConsequences=[
  law('series_checkpoint_lower_nested',ss.mul(den).atMost(sum.mul(sd))),
  law('series_finite_tail_bound',gap.mul(sum).plus(d.mul(term)).atMost(d.mul(t('initial')).mul(den))),
  law('series_bernoulli_majorant',d.plus(t('index').mul(gap)).mul(term).atMost(d.mul(t('initial')).mul(den))),
  law('series_checkpoint_upper_nested',gap.mul(sum).plus(d.mul(term)).mul(sd).atMost(gap.mul(ss).plus(d.mul(st)).mul(den))),
  law('series_constructive_modulus',t('index').atLeast(threshold).implies(t('precision').mul(d).mul(term).atMost(gap.mul(den)))),
  law('series_checkpoint_modulus',t('savedIndex').atLeast(threshold).implies(t('precision').mul(d).mul(st).atMost(gap.mul(sd)))),
];
export const seriesSteps=[
  law('series_lower_nested',after.sum.mul(den).atLeast(sum.mul(after.denominator))),
  law('series_upper_nested',gap.mul(after.sum).plus(d.mul(after.term)).mul(den)
    .atMost(gap.mul(sum).plus(d.mul(term)).mul(after.denominator))),
];
// Exact denominator identities link the general tail model to the exponential,
// Poisson and Bessel recurrences. The cutoffs prove a suitable finite start exists
// for every nonnegative rational argument, not just the runtime's [0,64] range.
export const seriesFamilies=rule('series_families').params({numerator:nat,denominator:nat,start:nat,order:nat,index:nat})
  .pre(e=>e.denominator.gt(0)).inputs({})
  .state({
    expBase:e=>e.denominator.mul(e.start.plus(1)),
    expGrowth:e=>e.denominator.mul(e.index),
    besselBase:e=>e.denominator.mul(e.denominator).times(4).mul(e.start.plus(1)).mul(e.start.plus(e.order).plus(1)),
    besselGrowth:e=>e.denominator.mul(e.denominator).times(4).mul(e.index).mul(e.start.times(2).plus(e.order).plus(2).plus(e.index)),
    expCutoff:e=>e.denominator.mul(e.numerator.plus(1)),
    besselCutoff:e=>e.denominator.mul(e.denominator).times(4).mul(e.numerator.mul(e.numerator).plus(1)).mul(e.numerator.mul(e.numerator).plus(e.order).plus(1)),
  }).step(e=>({expBase:e.expBase,expGrowth:e.expGrowth,besselBase:e.besselBase,besselGrowth:e.besselGrowth,
    expCutoff:e.expCutoff,besselCutoff:e.besselCutoff}));
export const seriesFamilyLaws=[
  seriesFamilies.law('series_exp_denominator_identity',e=>e.expBase.plus(e.expGrowth).eq(e.denominator.mul(e.start.plus(e.index).plus(1)))),
  seriesFamilies.law('series_bessel_denominator_identity',e=>e.besselBase.plus(e.besselGrowth).eq(e.denominator.mul(e.denominator).times(4).mul(e.start.plus(e.index).plus(1)).mul(e.start.plus(e.index).plus(e.order).plus(1)))),
  seriesFamilies.law('series_exp_denominator_positive',e=>e.expBase.gt(0)),
  seriesFamilies.law('series_bessel_denominator_positive',e=>e.besselBase.gt(0)),
  seriesFamilies.law('series_exp_cutoff_exists',e=>e.expCutoff.gt(e.numerator)),
  seriesFamilies.law('series_bessel_cutoff_exists',e=>e.besselCutoff.gt(e.numerator.mul(e.numerator))),
];

export const seriesProofs=[
  {name:'series_families',machine:seriesFamilies.machine,laws:seriesFamilyLaws},
  {name:'series_model',machine:series.machine,laws:seriesLaws,supports:{
    series_denominator_positive:[],
    series_tail_conservation:[],
    series_rate_conservation:[],
    series_checkpoint_denominator_positive:['series_denominator_positive'],
    series_checkpoint_rate_conservation:['series_rate_conservation'],
    series_checkpoint_index_bound:[],
    series_checkpoint_lower_conservation:[],
    series_checkpoint_conservation:[],
  }},
  {name:'series_consequences',from:'series_model',laws:seriesConsequences,supports:{
    series_checkpoint_lower_nested:['series_checkpoint_lower_conservation'],
    series_finite_tail_bound:['series_tail_conservation'],
    series_bernoulli_majorant:['series_rate_conservation'],
    series_checkpoint_upper_nested:['series_checkpoint_conservation'],
    series_constructive_modulus:['series_rate_conservation'],
    series_checkpoint_modulus:['series_checkpoint_rate_conservation'],
  }},
  {name:'series_cauchy',from:'series_model',using:['series_consequences'],laws:[
    law('series_all_future_prefixes_cauchy',t('savedIndex').atLeast(threshold).implies(
      t('precision').mul(sum).mul(sd).atMost(t('precision').mul(ss).mul(den).plus(den.mul(sd))))),
  ],supports:{series_all_future_prefixes_cauchy:['series_checkpoint_conservation','series_checkpoint_modulus']}},
  {name:'series_steps',from:'series_model',inputs:true,laws:seriesSteps,supports:{series_lower_nested:[],series_upper_nested:[]}},
].map(p=>({...p,polynomial:true}));
export const seriesLawNames=seriesProofs.flatMap(p=>p.laws.map(l=>l.name));
