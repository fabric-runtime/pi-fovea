// Pascal coefficients carry local factorial witnesses. This avoids treating
// factorial as a foreign function or fixing a maximum polynomial degree.
// B[k]=choose(row,k), K[k]=k!, R[k]=(row-k)!, I[k]=k, Q[k]=k mod 2.
// I keeps arithmetic inside the kernel's map-write fragment; it is checked,
// not supplied by a foreign function. This model is not compiled to JS Number.
import {rule,when,forall,Term} from 'gdp-wired';
const one=new Term({op:'const',value:1});
export const pascal=rule('pascal_factorials').inputs({})
  .state({ready:0,row:0,factorial:1}).maps({B:0,K:1,R:1,I:0,Q:0})
  .step(e=>{
    const init=e.ready.eq(0),next=e.row.plus(1),factorial=next.mul(e.factorial);
    return {ready:1,row:when(init,0,next),factorial:when(init,1,factorial),
      B:e.B.each(k=>when(init,when(k.eq(0),1,0),when(k.eq(0).or(k.eq(next)),1,
        when(k.lt(next),e.B.at(k).plus(e.B.at(k.minus(1))),0)))),
      K:e.K.each(k=>when(init,1,when(k.eq(next),factorial,e.K.at(k)))),
      I:e.I.set(when(init,0,next),when(init,0,next)),
      Q:e.Q.set(when(init,0,next),when(init,0,one.minus(e.Q.at(e.row)))),
      R:e.R.each(k=>when(init,1,when(k.atMost(e.row),next.minus(e.I.at(k)).mul(e.R.at(k)),1))),
    };
  });
export const pascalLaws=[
  pascal.law('pascal_ready_bit',e=>e.ready.atMost(1)),
  pascal.law('pascal_uninitialized',e=>e.ready.eq(0).implies(e.row.eq(0).and(e.factorial.eq(1)))),
  pascal.law('pascal_factorial_positive',e=>e.factorial.gt(0)),
  pascal.law('pascal_first_coefficient',e=>e.ready.eq(1).implies(e.B.at(0).eq(1))),
  pascal.law('pascal_last_coefficient',e=>e.ready.eq(1).implies(e.B.at(e.row).eq(1))),
  pascal.law('pascal_coefficients_supported',e=>forall(k=>k.gt(e.row).implies(e.B.at(k).eq(0)))),
  pascal.law('pascal_first_factorial',e=>e.K.at(0).eq(1)),
  pascal.law('pascal_last_factorial',e=>e.K.at(e.row).eq(e.factorial)),
  pascal.law('pascal_first_complement',e=>e.R.at(0).eq(e.factorial)),
  pascal.law('pascal_last_complement',e=>e.R.at(e.row).eq(1)),
  pascal.law('pascal_parity_zero',e=>e.Q.at(0).eq(0)),
  pascal.law('pascal_parity_bit',e=>forall(k=>k.atMost(e.row).implies(e.Q.at(k).atMost(1)))),
  pascal.law('pascal_parity_adjacent',e=>forall(k=>k.lt(e.row).implies(e.Q.at(k).plus(e.Q.at(k.plus(1))).eq(1)))),
  pascal.law('pascal_indices',e=>forall(k=>k.atMost(e.row).implies(e.I.at(k).eq(k)))),
  pascal.law('pascal_factorial_adjacent',e=>forall(k=>e.ready.eq(1).and(k.gt(0),k.atMost(e.row)).implies(e.K.at(k).eq(k.mul(e.K.at(k.minus(1))))))),
  pascal.law('pascal_complement_adjacent',e=>forall(k=>e.ready.eq(1).and(k.gt(0),k.atMost(e.row)).implies(e.R.at(k.minus(1)).eq(e.row.plus(1).minus(k).mul(e.R.at(k)))))),
  pascal.law('pascal_left_denominator_positive',e=>forall(k=>e.ready.eq(1).and(k.atMost(e.row)).implies(e.K.at(k).gt(0)))),
  pascal.law('pascal_right_denominator_positive',e=>forall(k=>e.ready.eq(1).and(k.atMost(e.row)).implies(e.R.at(k).gt(0)))),
  pascal.law('pascal_factorial_coefficient',e=>forall(k=>e.ready.eq(1).and(k.atMost(e.row)).implies(e.B.at(k).mul(e.K.at(k)).mul(e.R.at(k)).eq(e.factorial)))),
];
export const pascalSupport={
  pascal_ready_bit:[],pascal_uninitialized:[],pascal_factorial_positive:[],
  pascal_first_coefficient:['pascal_first_coefficient'],pascal_last_coefficient:[],
  pascal_coefficients_supported:[],pascal_first_factorial:['pascal_first_factorial'],
  pascal_last_factorial:['pascal_uninitialized'],pascal_first_complement:['pascal_first_complement','pascal_indices'],
  pascal_last_complement:[],
  pascal_parity_zero:['pascal_parity_zero'],
  pascal_parity_bit:['pascal_parity_bit','pascal_uninitialized'],
  pascal_parity_adjacent:['pascal_parity_bit','pascal_parity_adjacent','pascal_uninitialized'],
  pascal_indices:['pascal_indices','pascal_uninitialized'],
  pascal_factorial_adjacent:['pascal_uninitialized','pascal_factorial_adjacent','pascal_last_factorial'],
  pascal_complement_adjacent:['pascal_indices','pascal_uninitialized','pascal_complement_adjacent','pascal_last_complement'],
  pascal_left_denominator_positive:['pascal_factorial_positive','pascal_left_denominator_positive'],
  pascal_right_denominator_positive:['pascal_indices','pascal_right_denominator_positive'],
  pascal_factorial_coefficient:['pascal_ready_bit','pascal_uninitialized','pascal_first_factorial','pascal_first_complement','pascal_indices','pascal_factorial_adjacent','pascal_complement_adjacent'],
};
