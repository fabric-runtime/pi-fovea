// Terminating precision selection and constructive Cauchy-name comparison.
import { rule, nat, when, Term } from "gdp-wired";
import { product, side } from "gdp-wired/compose";
import type { Law } from "gdp-wired/machine";
import { taylorTail, taylorTailProofs } from "./taylor-tail.ts";
import type { ProofGroup } from "./types.ts";
const t = (name: string) => new Term({ op: "var", name });
export const precisionPlan = rule("operator_precision_plan")
  .params({ numerator: nat, precision: nat })
  .inputs({})
  .state({ index: 0, power: 1 })
  .step((e) => ({
    index: when(e.index.lt(e.numerator.times(6).plus(1)), e.index.plus(1), e.index),
    power: when(
      e.index.lt(e.numerator.times(6).plus(1)),
      e.power.mul(e.numerator.times(3)),
      e.power,
    ),
  }));
const planLaw = precisionPlan.law("operator_precision_plan_index", (e) =>
  e.index.atMost(e.numerator.times(6).plus(1)),
);
export const planCutoff = (numerator: Term, precision: Term, power: Term) => {
  const d = numerator.times(6).plus(1);
  return d.plus(precision.mul(d).mul(d).mul(power));
};
const pair = product(precisionPlan.machine, taylorTail.machine);
const d = t("numerator").times(6).plus(1);
const planLinks: Law[] = [
  {
    name: "operator_plan_tracks_prefix",
    holds: t("a_index").eq(when(t("b_phase").eq(0), t("b_m"), d)).c,
  },
  {
    name: "operator_plan_tracks_majorant",
    holds: t("a_power").eq(when(t("b_phase").eq(0), t("b_coarsePower"), t("b_initPower"))).c,
  },
  {
    name: "operator_plan_cutoff_ready",
    holds: t("b_phase")
      .eq(1)
      .implies(
        t("a_index")
          .eq(d)
          .and(
            planCutoff(t("numerator"), t("precision"), t("a_power")).eq(
              planCutoff(t("numerator"), t("precision"), t("b_initPower")),
            ),
          ),
      ).c,
  },
];
const prefixLaws = taylorTailProofs[0]!.laws
  .filter((l) =>
    ["taylor_tail_phase", "taylor_tail_prefix", "taylor_tail_index", "taylor_tail_before"].includes(
      l.name,
    ),
  )
  .map((l) => {
    if (!("holds" in l)) throw new Error("Expected invariant");
    return { ...l, holds: side(taylorTail.machine, "b_", l.holds) };
  });
export const limitComparison = rule("operator_limit_comparison")
  .params({
    precision: nat,
    den: nat,
    aP: nat,
    aN: nat,
    bP: nat,
    bN: nat,
    cP: nat,
    cN: nat,
    dP: nat,
    dN: nat,
    gap: nat,
  })
  .state({})
  .step(() => ({}));
const limitLaws = [
  limitComparison.law("operator_limit_three_error_transfer", (e) => {
    const close = (p: Term, n: Term, q: Term, r: Term) =>
      e.precision
        .times(3)
        .mul(p.plus(r))
        .atMost(e.precision.times(3).mul(n.plus(q)).plus(e.den))
        .and(
          e.precision
            .times(3)
            .mul(n.plus(q))
            .atMost(e.precision.times(3).mul(p.plus(r)).plus(e.den)),
        );
    return close(e.aP, e.aN, e.bP, e.bN)
      .and(close(e.aP, e.aN, e.cP, e.cN), close(e.cP, e.cN, e.dP, e.dN))
      .implies(
        e.precision
          .mul(e.bP.plus(e.dN))
          .atMost(e.precision.mul(e.bN.plus(e.dP)).plus(e.den))
          .and(
            e.precision.mul(e.bN.plus(e.dP)).atMost(e.precision.mul(e.bP.plus(e.dN)).plus(e.den)),
          ),
      );
  }),
  limitComparison.law("operator_limit_rational_separation", (e) =>
    e.gap.gt(0).implies(e.den.plus(1).mul(e.gap).gt(e.den)),
  ),
];
export const operatorLimitProofs: ProofGroup[] = [
  { name: "operator_precision_plan", machine: precisionPlan.machine, laws: [planLaw] },
  {
    name: "operator_precision_plan_termination",
    loop: {
      name: precisionPlan.machine.name,
      params: precisionPlan.machine.params,
      inputs: [],
      state: precisionPlan.machine.state,
      body: precisionPlan.machine.step.state!,
      while: t("index").lt(d).c,
    },
    laws: [planLaw],
    rank: d.minus(t("index")).e,
  },
  {
    name: "operator_precision_plan_binding",
    machine: pair,
    laws: [...prefixLaws, ...planLinks],
    supports: {
      operator_plan_tracks_prefix: [
        "operator_plan_tracks_prefix",
        "taylor_tail_phase",
        "taylor_tail_prefix",
        "taylor_tail_index",
      ],
      operator_plan_tracks_majorant: [
        "operator_plan_tracks_majorant",
        "operator_plan_tracks_prefix",
        "taylor_tail_phase",
        "taylor_tail_prefix",
        "taylor_tail_index",
      ],
      operator_plan_cutoff_ready: ["operator_plan_tracks_majorant", "operator_plan_tracks_prefix"],
    },
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 16000, rows: 32000 }),
  },
  {
    name: "operator_limit_comparison",
    machine: limitComparison.machine,
    laws: limitLaws,
    polynomial: true,
  },
];
