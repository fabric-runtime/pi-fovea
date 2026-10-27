// The actual (3t)^m/m! recurrence, including construction of its own finite
// starting term. The generic series inequalities are substituted and re-proved
// on this machine; no initial-term or eventual-tail bound is assumed.
import { rule, nat, bool, when, Term, Cond } from "gdp-wired";
import type { E, Law } from "gdp-wired/machine";
import { seriesLaws, seriesConsequences, seriesProofs } from "./series.ts";
import { bindCondition } from "./substitution.ts";
import type { ProofGroup } from "./types.ts";
export const taylorTail = rule("taylor_tail")
  .params({ numerator: nat, unitDen: nat, precision: nat })
  .pre((e) => e.unitDen.gt(0))
  .inputs({ checkpoint: bool, rowScale: nat })
  .assume((e) => e.rowScale.gt(0))
  .state({
    phase: 0,
    m: 0,
    tailIndex: 0,
    power: 1,
    coarsePower: 1,
    baseDen: 1,
    scaleProduct: 1,
    actualDen: 1,
    initPower: 0,
    initDen: 1,
    tailDen: 1,
    sumNum: 0,
    tailSlack: 0,
    rateSlack: 0,
    savedIndex: 0,
    savedDen: 1,
    savedPower: 0,
    savedSum: 0,
    windowSlack: 0,
    lowerSlack: 0,
    savedRateSlack: 0,
  })
  .step((e) => {
    const n = e.numerator.times(3),
      gap = n.plus(1),
      d = n.plus(gap),
      divisor = e.unitDen.mul(e.m.plus(1));
    const tail = e.phase.eq(1),
      activate = e.phase.eq(0).and(e.m.plus(1).eq(d)),
      growth = divisor.minus(d);
    const result = {
      phase: when(activate, 1, e.phase),
      m: e.m.plus(1),
      tailIndex: when(tail, e.tailIndex.plus(1), e.tailIndex),
      power: e.power.mul(n),
      coarsePower: e.coarsePower.mul(n),
      baseDen: e.baseDen.mul(divisor),
      scaleProduct: e.scaleProduct.mul(e.rowScale),
      actualDen: e.actualDen.mul(divisor),
      initPower: when(activate, e.coarsePower.mul(n), e.initPower),
      initDen: when(activate, e.actualDen.mul(divisor), e.initDen),
      tailDen: when(tail, e.tailDen.mul(divisor), e.tailDen),
      sumNum: when(tail, e.sumNum.plus(e.power).mul(divisor), e.sumNum),
      tailSlack: when(tail, e.tailSlack.mul(divisor).plus(n.mul(growth).mul(e.power)), e.tailSlack),
      rateSlack: when(
        tail,
        e.rateSlack.mul(divisor).plus(
          e.power.mul(
            gap
              .mul(gap)
              .mul(e.tailIndex.plus(1))
              .plus(growth.mul(d.plus(e.tailIndex.mul(gap)))),
          ),
        ),
        e.rateSlack,
      ),
      savedIndex: when(tail.and(e.checkpoint), e.tailIndex, e.savedIndex),
      savedDen: when(tail.and(e.checkpoint), e.actualDen, e.savedDen),
      savedPower: when(
        activate,
        e.power.mul(n),
        when(tail.and(e.checkpoint), e.power, e.savedPower),
      ),
      savedSum: when(tail.and(e.checkpoint), e.sumNum, e.savedSum),
      windowSlack: when(
        tail,
        when(e.checkpoint, 0, e.windowSlack)
          .mul(divisor)
          .plus(
            n
              .mul(growth)
              .mul(e.power)
              .mul(when(e.checkpoint, e.actualDen, e.savedDen)),
          ),
        e.windowSlack,
      ),
      lowerSlack: when(
        tail,
        when(e.checkpoint, 0, e.lowerSlack)
          .mul(divisor)
          .plus(e.power.mul(divisor).mul(when(e.checkpoint, e.actualDen, e.savedDen))),
        e.lowerSlack,
      ),
      savedRateSlack: when(tail.and(e.checkpoint), e.rateSlack, e.savedRateSlack),
    };
    // Exact common-denominator rescaling, shared with the residual assembler.
    result.power = result.power.mul(e.rowScale);
    result.actualDen = result.actualDen.mul(e.rowScale);
    for (const key of ["initDen", "savedPower"] as const)
      result[key] = when(activate, result[key].mul(e.rowScale), result[key]);
    for (const key of [
      "tailDen",
      "sumNum",
      "tailSlack",
      "rateSlack",
      "windowSlack",
      "lowerSlack",
    ] as const)
      result[key] = when(tail, result[key].mul(e.rowScale), result[key]);
    const initialSlack = d
      .mul(e.coarsePower.mul(n))
      .mul(e.scaleProduct.mul(e.rowScale))
      .mul(e.baseDen.mul(divisor).minus(1));
    result.tailSlack = when(activate, initialSlack, result.tailSlack);
    result.rateSlack = when(activate, initialSlack, result.rateSlack);
    result.savedRateSlack = when(activate, initialSlack, result.savedRateSlack);
    result.savedDen = when(activate, e.actualDen.mul(divisor).mul(e.rowScale), result.savedDen);
    return result;
  });
const t = (name: string) => new Term({ op: "var", name });
const n = t("numerator").times(3),
  gap = n.plus(1),
  d = n.plus(gap);
const variables: Record<string, E> = {
  n: n.e,
  gap: gap.e,
  initial: t("initPower").e,
  precision: t("precision").e,
  index: t("tailIndex").e,
  denominator: t("actualDen").e,
  term: t("power").e,
  sum: t("sumNum").e,
  savedIndex: t("savedIndex").e,
  savedDenominator: t("savedDen").e,
  savedTerm: t("savedPower").e,
  savedSum: t("savedSum").e,
  tailSlack: t("tailSlack").e,
  rateSlack: t("rateSlack").e,
  windowSlack: t("windowSlack").e,
  lowerSlack: t("lowerSlack").e,
  savedRateSlack: t("savedRateSlack").e,
};
const name = (s: string) => s.replace(/^series_/, "taylor_tail_");
const bind = (law: Law): Law => ({
  name: name(law.name),
  holds: t("phase")
    .eq(1)
    .implies(new Cond(bindCondition(law.holds, variables))).c,
});
const base = [
  taylorTail.law("taylor_tail_phase", (e) => e.phase.atMost(1)),
  taylorTail.law("taylor_tail_prefix", (e) =>
    e.phase.eq(0).implies(e.m.lt(e.numerator.times(6).plus(1))),
  ),
  taylorTail.law("taylor_tail_index", (e) =>
    e.phase.eq(1).implies(e.m.eq(e.numerator.times(6).plus(1).plus(e.tailIndex))),
  ),
  taylorTail.law("taylor_tail_base_denominator", (e) => e.baseDen.gt(0)),
  taylorTail.law("taylor_tail_scale_product", (e) => e.scaleProduct.gt(0)),
  taylorTail.law("taylor_tail_exact_power", (e) => e.power.eq(e.coarsePower.mul(e.scaleProduct))),
  taylorTail.law("taylor_tail_exact_denominator", (e) =>
    e.actualDen.eq(e.baseDen.mul(e.scaleProduct)),
  ),
  taylorTail.law("taylor_tail_actual_denominator", (e) => e.actualDen.gt(0)),
  taylorTail.law("taylor_tail_initial_denominator", (e) => e.initDen.gt(0)),
  taylorTail.law("taylor_tail_denominator_factor", (e) =>
    e.phase.eq(1).implies(e.actualDen.eq(e.initDen.mul(e.tailDen))),
  ),
  taylorTail.law("taylor_tail_ratio_base", (e) =>
    e.phase.eq(1).implies(e.unitDen.mul(e.m.plus(1)).atLeast(e.numerator.times(6).plus(1))),
  ),
  taylorTail.law("taylor_tail_before", (e) =>
    e.phase
      .eq(0)
      .implies(
        e.tailIndex
          .eq(0)
          .and(
            e.tailDen.eq(1),
            e.sumNum.eq(0),
            e.tailSlack.eq(0),
            e.rateSlack.eq(0),
            e.savedIndex.eq(0),
            e.savedDen.eq(1),
            e.savedSum.eq(0),
            e.windowSlack.eq(0),
            e.lowerSlack.eq(0),
            e.savedRateSlack.eq(0),
          ),
      ),
  ),
];
const generic = seriesLaws.map(bind),
  consequences = seriesConsequences.map(bind);
const source = seriesProofs.find((g) => g.name === "series_model")!;
const sourceConsequences = seriesProofs.find((g) => g.name === "series_consequences")!;
const futureSource = seriesProofs.find((g) => g.name === "series_cauchy")!;
const future = futureSource.laws.map((l) => {
  if (!("holds" in l)) throw new Error("Expected series invariant");
  return bind(l);
});
const common = base.map((l) => l.name);
const supports = Object.fromEntries([
  ...base.map((l) => [l.name, common]),
  ...generic.map((l, i) => [
    l.name,
    [...common, ...(source.supports?.[seriesLaws[i]!.name] ?? []).map(name)],
  ]),
]);
export const taylorTailProofs: ProofGroup[] = [
  {
    name: "taylor_tail_model",
    machine: taylorTail.machine,
    laws: [...base, ...generic],
    supports,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 24000, rows: 48000 }),
  },
  {
    name: "taylor_tail_consequences",
    from: "taylor_tail_model",
    laws: consequences,
    supports: Object.fromEntries(
      consequences.map((l, i) => [
        l.name,
        (sourceConsequences.supports?.[seriesConsequences[i]!.name] ?? []).map(name),
      ]),
    ),
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 24000, rows: 48000, linearProducts: true }),
  },
  {
    name: "taylor_tail_future",
    from: "taylor_tail_model",
    using: ["taylor_tail_consequences"],
    laws: future,
    supports: Object.fromEntries(
      future.map((l, i) => [
        l.name,
        (futureSource.supports?.[futureSource.laws[i]!.name] ?? []).map(name),
      ]),
    ),
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 24000, rows: 48000, linearProducts: true }),
  },
];
