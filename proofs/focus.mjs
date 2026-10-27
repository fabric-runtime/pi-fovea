// Exact row-stochastic gather: the transpose/infinity-norm counterpart to
// transport.mjs. A row is committed only after consuming D units of weight;
// a round flips buffers only after every row is committed. No CSR/IEEE claim.
import {rule,nat,bool,record,when,forall,Term} from 'gdp-wired';
const Pair=record({p:nat,n:nat});
const term=name=>new Term({op:'var',name});
const mass=x=>x.p.plus(x.n);
const current=(e,k)=>when(e.phase.eq(0),mass(e.A.at(k)),mass(e.B.at(k)));
const one=new Term({op:'const',value:1});
export const focus=rule('indexed_focus_gather').params({divisor:nat,size:nat,inputBound:nat}).pre(e=>e.divisor.gt(0))
  .inputs({action:nat,at:nat,magnitude:nat,negative:bool,weight:nat})
  .state({started:0,phase:0,cursor:0,active:0,remaining:0,pendingP:0,pendingN:0,denominator:1,bound:e=>e.inputBound,round:0})
  .maps({A:Pair.from({p:0,n:0}),B:Pair.from({p:0,n:0})})
  .flags(e=>({
    seed:e.action.eq(0).and(e.started.eq(0),e.phase.eq(0),e.at.lt(e.size),e.magnitude.atMost(e.bound),mass(e.A.at(e.at)).eq(0)),
    begin:e.action.eq(1).and(e.active.eq(0),e.cursor.lt(e.size)),
    gather:e.action.eq(2).and(e.active.eq(1),e.at.lt(e.size),e.weight.atMost(e.remaining)),
    commit:e.action.eq(3).and(e.active.eq(1),e.remaining.eq(0),e.cursor.lt(e.size)),
    flip:e.action.eq(4).and(e.active.eq(0),e.cursor.eq(e.size)),
  }))
  .step(e=>{
    const a=e.A.at(e.at),b=e.B.at(e.at),sourceP=when(e.phase.eq(0),a.p,b.p),sourceN=when(e.phase.eq(0),a.n,b.n);
    const outP=e.pendingP.minus(e.pendingN),outN=e.pendingN.minus(e.pendingP),clear=e.begin.or(e.commit);
    const targetA=e.A.at(e.cursor),targetB=e.B.at(e.cursor);
    return {
      started:when(e.begin.or(e.flip),1,e.started),phase:when(e.flip,one.minus(e.phase),e.phase),
      cursor:when(e.flip,0,when(e.commit,e.cursor.plus(1),e.cursor)),active:when(e.begin,1,when(e.commit,0,e.active)),
      remaining:when(e.begin,e.divisor,when(e.gather,e.remaining.minus(e.weight),e.remaining)),
      pendingP:when(clear,0,when(e.gather,e.pendingP.plus(e.weight.mul(sourceP)),e.pendingP)),
      pendingN:when(clear,0,when(e.gather,e.pendingN.plus(e.weight.mul(sourceN)),e.pendingN)),
      denominator:when(e.flip,e.denominator.mul(e.divisor),e.denominator),bound:when(e.flip,e.bound.mul(e.divisor),e.bound),
      round:when(e.flip,e.round.plus(1),e.round),
      A:e.A.set(when(e.seed,e.at,e.cursor),{
        p:when(e.seed,when(e.negative,0,e.magnitude),when(e.commit.and(e.phase.eq(1)),outP,targetA.p)),
        n:when(e.seed,when(e.negative,e.magnitude,0),when(e.commit.and(e.phase.eq(1)),outN,targetA.n)),
      }),
      B:e.B.set(e.cursor,{p:when(e.commit.and(e.phase.eq(0)),outP,targetB.p),n:when(e.commit.and(e.phase.eq(0)),outN,targetB.n)}),
    };
  });
export const focusLaws=[
  focus.law('focus_phase_bit',e=>e.phase.atMost(1)),
  focus.law('focus_started_bit',e=>e.started.atMost(1)),
  focus.law('focus_active_bit',e=>e.active.atMost(1)),
  focus.law('focus_cursor_bound',e=>e.cursor.atMost(e.size)),
  focus.law('focus_idle_clean',e=>e.active.eq(0).implies(e.remaining.eq(0).and(e.pendingP.eq(0),e.pendingN.eq(0)))),
  focus.law('focus_denominator_positive',e=>e.denominator.gt(0)),
  focus.law('focus_scale_exact',e=>e.bound.eq(e.inputBound.mul(e.denominator))),
  ...['A','B'].map(name=>focus.law(`focus_${name}_canonical`,e=>forall(k=>e[name].at(k).p.eq(0).or(e[name].at(k).n.eq(0))))),
  ...['A','B'].map((name,phase)=>focus.law(`focus_${name}_point_bound`,e=>forall(k=>mass(e[name].at(k)).atMost(when(e.phase.eq(phase),e.bound,e.divisor.mul(e.bound)))))),
  focus.law('focus_accumulator_budget',e=>e.pendingP.plus(e.pendingN).plus(e.remaining.mul(e.bound)).atMost(e.divisor.mul(e.bound))),
  focus.law('focus_global_linf_bound',e=>forall(k=>current(e,k).atMost(e.inputBound.mul(e.denominator)))),
];
export const focusSteps=[
  focus.stepLaw('focus_weight_consumed',(a,b)=>b.remaining.plus(a.weight).eq(a.remaining),e=>e.gather),
  focus.stepLaw('focus_row_progress',(a,b)=>b.cursor.eq(a.cursor.plus(1)).and(b.active.eq(0)),e=>e.commit),
  focus.stepLaw('focus_round_covers_rows',a=>a.cursor.eq(a.size),e=>e.flip),
  focus.stepLaw('focus_round_progress',(a,b)=>b.round.eq(a.round.plus(1)).and(b.denominator.eq(a.denominator.mul(a.divisor)),b.cursor.eq(0)),e=>e.flip),
  focus.stepLaw('focus_completed_row_bound',a=>a.pendingP.plus(a.pendingN).atMost(a.divisor.mul(a.bound)),e=>e.commit),
  focus.stepLaw('focus_row_value',(a,b)=>{
    const p=when(a.phase.eq(0),b.B.at(a.cursor).p,b.A.at(a.cursor).p),n=when(a.phase.eq(0),b.B.at(a.cursor).n,b.A.at(a.cursor).n);
    return p.eq(a.pendingP.minus(a.pendingN)).and(n.eq(a.pendingN.minus(a.pendingP)));
  },e=>e.commit),
];
const supports=Object.fromEntries(focusLaws.map(l=>[l.name,[]]));
supports.focus_A_point_bound=['focus_phase_bit','focus_B_point_bound','focus_accumulator_budget'];
supports.focus_B_point_bound=['focus_phase_bit','focus_A_point_bound','focus_accumulator_budget'];
supports.focus_accumulator_budget=['focus_phase_bit','focus_idle_clean','focus_A_point_bound','focus_B_point_bound'];
supports.focus_global_linf_bound=['focus_phase_bit','focus_A_point_bound','focus_B_point_bound','focus_scale_exact'];
const instances=l=>Object.fromEntries(focusLaws.filter(x=>x.forall).map(x=>[x.name,[term('at').e,...(l.forall?[term(l.forall+'#').e]:[])]]));
const cuts=[{phase:1},{action:1},{action:1,'1':-1},{action:1,'1':-2},{action:1,'1':-3}];
export const focusProofs=[
  {name:'indexed_focus',machine:focus.machine,laws:focusLaws,supports,instances,
    polynomial:['focus_scale_exact','focus_A_point_bound','focus_B_point_bound','focus_accumulator_budget','focus_global_linf_bound'],
    search:l=>l.name==='focus_scale_exact'?{closureRounds:1,nodes:128,products:2500,rows:5000}
      :l.name.endsWith('_point_bound')?{ms:12000,nodes:768,products:5000,rows:10000,closureRounds:1,cuts}
      :l.name==='focus_accumulator_budget'?{ms:12000,nodes:512,products:3000,rows:6000,closureRounds:1,cuts}
      :{nodes:192,products:2000,rows:4000}},
  {name:'focus_steps',from:'indexed_focus',steps:true,laws:focusSteps,instances,polynomial:true,
    supports:Object.fromEntries(focusSteps.map(l=>[l.name,l.name==='focus_completed_row_bound'?['focus_accumulator_budget']:l.name==='focus_row_value'?['focus_phase_bit']:[]]))},
];
export const focusLawNames=focusProofs.flatMap(p=>p.laws.map(l=>l.name));
