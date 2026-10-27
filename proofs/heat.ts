// Exact algebra only. A tree is a finite list decomposition; no bounded sampling.
import { fold, fun, nat } from "gdp-wired";
import { nonneg, rat, ratRule } from "gdp-wired/rationals";
import type { Fold } from "gdp-wired/kernel";
import type { Law } from "gdp-wired/machine";
export const addition = fold("vector addition")
  .inputs({ x: nat, y: nat })
  .leaf(({ x, y }) => ({ xs: x, ys: y, sum: x.plus(y) }))
  .node((_, a, b) => ({ xs: a.xs.plus(b.xs), ys: a.ys.plus(b.ys), sum: a.sum.plus(b.sum) }));
export const scaling = fold("vector scaling")
  .params({ mass: nat })
  .inputs({ weight: nat })
  .leaf(({ mass, weight }) => ({ weights: weight, scaled: mass.mul(weight) }))
  .node((_, a, b) => ({ weights: a.weights.plus(b.weights), scaled: a.scaled.plus(b.scaled) }));
export const transport = fold("normalized source columns")
  .params({ denominator: nat })
  .pre(({ denominator }) => denominator.atLeast(1))
  .inputs({ mass: nat, weightSum: nat })
  .assume(({ weightSum, denominator }) => weightSum.eq(denominator))
  .leaf(({ mass, weightSum }) => ({ input: mass, output: mass.mul(weightSum) }))
  .node((_, a, b) => ({ input: a.input.plus(b.input), output: a.output.plus(b.output) }));
export const singleton = fun("singleton source")
  .inputs({ mass: nat })
  .returns(({ mass }) => ({ output: mass.times(1) }));
export const heatLaws: [{ fold: Fold }, Law][] = [
  [addition, addition.law("heat_vector_add_mass", (e) => e.sum.eq(e.xs.plus(e.ys)))],
  [scaling, scaling.law("heat_scale_mass", (e) => e.scaled.eq(e.mass.mul(e.weights)))],
  [transport, transport.law("heat_transport_mass", (e) => e.output.eq(e.input.mul(e.denominator)))],
];
export const singletonLaw = singleton.law(
  "heat_singleton_mass",
  () => [],
  (o, e) => o.output.eq(e.mass),
);
// Conditional envelope: callers must establish each local numerical bound.
export const errors = ratRule("numerical error envelope")
  .params({ roundoff: nonneg })
  .inputs({ propagated: rat, local: rat })
  .state({ error: 0, bound: 0 })
  .assume(({ propagated, local, bound, roundoff }) =>
    propagated
      .atLeast(bound.negate())
      .and(propagated.atMost(bound), local.atLeast(roundoff.negate()), local.atMost(roundoff)),
  )
  .step(({ propagated, local, bound, roundoff }) => ({
    error: propagated.plus(local),
    bound: bound.plus(roundoff),
  }));
export const errorLaw = errors.law("rounding_envelope", ({ error, bound }) =>
  error.atLeast(bound.negate()).and(error.atMost(bound)),
);
