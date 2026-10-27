// Exact finite Cauchy-row assembly. Each admitted row is the evaluated output
// of binomialResidual at this index, with the same cutoff. Its norm and low-row
// equality are checked here as guards, not accepted as foreign arithmetic facts.
import { rule, nat, when } from "gdp-wired";
import type { ProofGroup } from "./types.ts";
export const residualSeries = rule("residual_series")
  .params({ cutoff: nat, last: nat, numerator: nat, denominator: nat })
  .pre((e) => e.denominator.gt(0).and(e.last.atLeast(e.cutoff)))
  .inputs({ rowP: nat, rowN: nat, rowDen: nat, refP: nat, refN: nat })
  .state({
    index: 0,
    termNum: 1,
    termDen: 1,
    power3: 1,
    den: 1,
    p: 0,
    n: 0,
    rawP: 0,
    rawN: 0,
    bound: 0,
    slack: 0,
    eNum: 0,
    eSlack: 0,
  })
  .flags((e) => ({
    take: e.index
      .atMost(e.last)
      .and(
        e.rowDen.gt(0),
        e.rowP.plus(e.rowN).atMost(e.power3.mul(e.rowDen)),
        e.index.gt(e.cutoff).or(e.rowP.plus(e.refN).eq(e.rowN.plus(e.refP))),
      ),
  }))
  .step((e) => {
    const high = e.index.gt(e.cutoff),
      nextDivisor = e.index.plus(1).mul(e.denominator),
      scale = e.rowDen.mul(nextDivisor),
      weight = e.termNum.mul(nextDivisor);
    const termP = when(high, e.rowP, 0),
      termN = when(high, e.rowN, 0);
    return {
      index: when(e.take, e.index.plus(1), e.index),
      termNum: when(e.take, e.termNum.mul(e.numerator).mul(e.rowDen), e.termNum),
      termDen: when(e.take, e.termDen.mul(e.index.plus(1)).mul(e.denominator), e.termDen),
      power3: when(e.take, e.power3.times(3), e.power3),
      den: when(e.take, e.den.mul(scale), e.den),
      p: when(e.take, e.p.mul(scale).plus(termP.mul(weight)), e.p),
      n: when(e.take, e.n.mul(scale).plus(termN.mul(weight)), e.n),
      rawP: when(
        e.take,
        e.rawP.mul(scale).plus(e.rowP.plus(when(high, 0, e.refN)).mul(weight)),
        e.rawP,
      ),
      rawN: when(
        e.take,
        e.rawN.mul(scale).plus(e.rowN.plus(when(high, 0, e.refP)).mul(weight)),
        e.rawN,
      ),
      bound: when(
        e.take,
        e.bound.mul(scale).plus(when(high, e.power3.mul(e.termNum).mul(scale), 0)),
        e.bound,
      ),
      slack: when(
        e.take,
        e.slack
          .mul(scale)
          .plus(when(high, e.power3.mul(e.rowDen).minus(e.rowP.plus(e.rowN)).mul(weight), 0)),
        e.slack,
      ),
      eNum: when(e.take, e.eNum.mul(scale).plus(when(high, 0, e.termNum.mul(scale))), e.eNum),
      eSlack: when(
        e.take,
        when(e.index.eq(0), 0, e.eSlack.mul(scale).plus(when(high, 0, e.termNum.mul(scale)))),
        e.eSlack,
      ),
    };
  });
export const residualSeriesLaws = [
  residualSeries.law("residual_series_index", (e) => e.index.atMost(e.last.plus(1))),
  residualSeries.law("residual_series_term_denominator", (e) => e.termDen.gt(0)),
  residualSeries.law("residual_series_denominator", (e) => e.den.gt(0)),
  residualSeries.law("residual_series_initial", (e) =>
    e.index
      .eq(0)
      .implies(e.termNum.eq(1).and(e.termDen.eq(1), e.eNum.eq(0), e.den.eq(1), e.power3.eq(1))),
  ),
  residualSeries.law("residual_series_norm_conservation", (e) =>
    e.p.plus(e.n).plus(e.slack).eq(e.bound),
  ),
  residualSeries.law("residual_series_low_cancellation", (e) =>
    e.rawP.plus(e.n).eq(e.rawN.plus(e.p)),
  ),
  residualSeries.law("residual_series_scalar_conservation", (e) =>
    e.index.gt(0).implies(e.eNum.eq(e.den.plus(e.eSlack))),
  ),
];
export const residualSeriesResults = [
  residualSeries.stepLaw("residual_series_finite_norm_bound", (e) => e.p.plus(e.n).atMost(e.bound)),
  residualSeries.stepLaw("residual_series_positive_normalizer", (e) =>
    e.index.gt(0).implies(e.eNum.gt(0)),
  ),
  residualSeries.stepLaw("residual_series_normalized_error_bound", (e) =>
    e.index.gt(0).implies(e.p.plus(e.n).mul(e.den).atMost(e.bound.mul(e.eNum))),
  ),
];
const supports = Object.fromEntries(
  residualSeriesLaws.map((l) => [
    l.name,
    [
      l.name,
      "residual_series_initial",
      "residual_series_term_denominator",
      "residual_series_denominator",
    ],
  ]),
);
export const residualSeriesProofs: ProofGroup[] = [
  {
    name: "residual_series_model",
    machine: residualSeries.machine,
    laws: residualSeriesLaws,
    supports,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 256, products: 18000, rows: 36000 }),
  },
  {
    name: "residual_series_results",
    from: "residual_series_model",
    steps: true,
    laws: residualSeriesResults,
    supports: {
      residual_series_finite_norm_bound: ["residual_series_norm_conservation"],
      residual_series_positive_normalizer: [
        "residual_series_scalar_conservation",
        "residual_series_denominator",
      ],
      residual_series_normalized_error_bound: [
        "residual_series_norm_conservation",
        "residual_series_scalar_conservation",
      ],
    },
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 256, products: 18000, rows: 36000, linearProducts: true }),
  },
];
