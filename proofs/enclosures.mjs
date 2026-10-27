// Constructive counterparts of the interval policies: integer witnesses and
// scaled rational endpoints. No real-number, IEEE or host-loop axioms are used.
import {rule,nat,when} from 'gdp-wired';
export const quotient=rule('quotient_enclosures').params({n:nat,q:nat,d:nat,r:nat})
  .pre(e=>e.d.gt(0).and(e.r.lt(e.d),e.n.eq(e.q.mul(e.d).plus(e.r))))
  .state({}).step(()=>({}));
const ceiling=e=>when(e.r.eq(0),e.q,e.q.plus(1));
export const quotientLaws=[
  quotient.law('enclosure_floor_bounds',e=>e.d.mul(e.q).atMost(e.n).and(e.n.lt(e.d.mul(e.q.plus(1))))),
  quotient.law('enclosure_ceil_bounds',e=>e.n.atMost(e.d.mul(ceiling(e))).and(e.d.mul(ceiling(e)).lt(e.n.plus(e.d)))),
];
export const enclosure=rule('rational_interval_policies')
  .params({al:nat,a:nat,au:nat,bl:nat,b:nat,bu:nat,candidate:nat,epsilon:nat})
  .pre(e=>e.al.atMost(e.a).and(e.a.atMost(e.au),e.bl.atMost(e.b),e.b.atMost(e.bu)))
  .state({}).step(()=>({}));
export const enclosureLaws=[
  enclosure.law('enclosure_add',e=>e.al.plus(e.bl).atMost(e.a.plus(e.b)).and(e.a.plus(e.b).atMost(e.au.plus(e.bu)))),
  enclosure.law('enclosure_multiply',e=>e.al.mul(e.bl).atMost(e.a.mul(e.b)).and(e.a.mul(e.b).atMost(e.au.mul(e.bu)))),
  // al/bu <= a/b <= au/bl, encoded by cross multiplication; bl>0 also
  // proves positivity of b and bu. Endpoint units are arbitrary exact rationals.
  enclosure.law('enclosure_divide',e=>e.bl.gt(0).implies(e.al.mul(e.b).atMost(e.a.mul(e.bu)).and(e.a.mul(e.bl).atMost(e.au.mul(e.b))))),
  // al-bu <= a-b <= au-bl, expressed without truncating signed differences.
  enclosure.law('enclosure_signed',e=>e.al.plus(e.b).atMost(e.a.plus(e.bu)).and(e.a.plus(e.bl).atMost(e.au.plus(e.b)))),
  // Absolute distances are two inequalities. A common offset handles signed
  // coordinates; a common positive scale handles arbitrary rational endpoints.
  enclosure.law('enclosure_certificate_error',e=>e.candidate.atMost(e.al.plus(e.epsilon)).and(e.al.atMost(e.candidate.plus(e.epsilon)),
    e.candidate.atMost(e.au.plus(e.epsilon)),e.au.atMost(e.candidate.plus(e.epsilon))).implies(
      e.candidate.atMost(e.a.plus(e.epsilon)).and(e.a.atMost(e.candidate.plus(e.epsilon))))),
];
export const enclosureProofs=[
  {name:'quotient_enclosures',machine:quotient.machine,laws:quotientLaws,polynomial:true},
  {name:'rational_enclosures',machine:enclosure.machine,laws:enclosureLaws,polynomial:true},
];
export const enclosureLawNames=enclosureProofs.flatMap(p=>p.laws.map(l=>l.name));
