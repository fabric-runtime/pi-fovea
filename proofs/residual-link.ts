// A kernel-checked forward simulation connects the actual residual accumulator
// and actual Taylor-tail recurrence. It proves their denominator, term and tail
// identities together, rather than assuming separate models correspond.
import { Term, Cond } from "gdp-wired";
import type { E, Law, Machine } from "gdp-wired/machine";
import { refinement, side } from "gdp-wired/compose";
import { bindCondition, bindExpression } from "./substitution.ts";
import { residualSeries, residualSeriesLaws, residualSeriesProofs } from "./residual-series.ts";
import { taylorTail, taylorTailProofs } from "./taylor-tail.ts";
import type { ProofGroup, SupportMap } from "./types.ts";
const t = (s: string) => new Term({ op: "var", name: s });
const law = (name: string, c: Cond): Law => ({ name, holds: c.c });
const original = taylorTail.machine;
const names = [...original.params, ...original.inputs, ...Object.keys(original.state)];
const aliases: Record<string, E> = Object.fromEntries(
  names.map((n) => [n, t(n === "unitDen" ? "denominator" : n).e]),
);
const tail: Machine = {
  ...original,
  params: original.params.map((n) => (n === "unitDen" ? "denominator" : n)),
  state: Object.fromEntries(
    Object.entries(original.state).map(([n, e]) => [n, bindExpression(e, aliases)]),
  ),
  step: {
    ...original.step,
    state: Object.fromEntries(
      Object.entries(original.step.state ?? {}).map(([n, e]) => [n, bindExpression(e, aliases)]),
    ),
  },
  ...(original.pre ? { pre: bindCondition(original.pre, aliases) } : {}),
  ...(original.assume ? { assume: bindCondition(original.assume, aliases) } : {}),
};
const linked = refinement(residualSeries.machine, tail, {
  name: "residual_tail_link",
  relation: [],
  witness: {
    checkpoint: new Term({
      op: "if",
      c: t("a_index").eq(t("cutoff").plus(1)).c,
      then: { op: "const", value: 1 },
      else: { op: "const", value: 0 },
    }).e,
    rowScale: t("rowDen").e,
  },
  stutter: { op: "not", x: { op: "flag", name: "a_take" } },
});
const d = t("numerator").times(6).plus(1),
  threshold = t("precision").mul(d).mul(d).mul(t("b_initPower"));
const machine: Machine = {
  ...linked.machine,
  pre: new Cond(linked.machine.pre!).and(t("cutoff").atLeast(d)).c,
};
const lhs = (l: Law): Law => ({ ...l, holds: side(residualSeries.machine, "a_", l.holds) });
const rhs = (l: Law): Law => ({ ...l, holds: side(tail, "b_", bindCondition(l.holds, aliases)) });
const a = residualSeriesLaws.map(lhs);
const b = taylorTailProofs[0]!.laws.map((l) => {
  if (!("holds" in l)) throw new Error("Expected tail invariant");
  return rhs(l);
});
const links = [
  law("residual_link_index", t("a_index").eq(t("b_m"))),
  law("residual_link_denominator", t("a_den").eq(t("b_actualDen"))),
  law("residual_link_term", t("a_termNum").mul(t("a_power3")).eq(t("b_power"))),
  law(
    "residual_link_before_tail",
    t("a_index").atMost(t("cutoff").plus(1)).implies(t("a_bound").eq(0)),
  ),
  law(
    "residual_link_checkpoint",
    t("a_index")
      .gt(t("cutoff").plus(1))
      .implies(t("b_savedIndex").plus(d).eq(t("cutoff").plus(1))),
  ),
  law(
    "residual_link_finite_tail",
    t("a_index")
      .gt(t("cutoff").plus(1))
      .implies(t("a_bound").mul(t("b_savedDen")).eq(t("b_lowerSlack"))),
  ),
];
const baseSupport: SupportMap = {
  ...residualSeriesProofs[0]!.supports,
  ...taylorTailProofs[0]!.supports,
  residual_link_index: ["residual_link_index"],
  residual_link_denominator: ["residual_link_denominator", "residual_link_index"],
  residual_link_term: ["residual_link_term"],
  residual_link_before_tail: ["residual_link_before_tail"],
  residual_link_checkpoint: [
    "residual_link_checkpoint",
    "residual_link_index",
    "taylor_tail_index",
    "taylor_tail_prefix",
    "taylor_tail_phase",
  ],
  residual_link_finite_tail: [
    "residual_link_finite_tail",
    "residual_link_before_tail",
    "residual_link_index",
    "residual_link_term",
    "taylor_tail_phase",
    "taylor_tail_prefix",
  ],
};
const tailConsequences = taylorTailProofs[1]!.laws.map((l) => {
  if (!("holds" in l)) throw new Error("Expected tail consequence");
  return rhs(l);
});
const ready = law(
  "residual_link_precision_ready",
  t("a_index")
    .gt(t("cutoff").plus(1))
    .and(t("cutoff").atLeast(d.plus(threshold)))
    .implies(t("b_phase").eq(1).and(t("b_savedIndex").atLeast(threshold))),
);
const final = law(
  "residual_link_normalized_precision",
  t("a_index")
    .eq(t("last").plus(1))
    .and(t("last").gt(t("cutoff")), t("cutoff").atLeast(d.plus(threshold)))
    .implies(
      t("precision")
        .mul(t("a_p").plus(t("a_n")))
        .atMost(t("a_eNum")),
    ),
);
const unnormalized = law(
  "residual_link_cauchy_precision",
  t("a_index")
    .eq(t("last").plus(1))
    .and(t("last").gt(t("cutoff")), t("cutoff").atLeast(d.plus(threshold)))
    .implies(
      t("precision")
        .mul(t("a_p").plus(t("a_n")))
        .atMost(t("a_den")),
    ),
);
const future = taylorTailProofs[2]!.laws.map((l) => {
  if (!("holds" in l)) throw new Error("Expected future consequence");
  return rhs(l);
});
export const residualLinkProofs: ProofGroup[] = [
  {
    name: "residual_link_model",
    machine,
    laws: [
      ...a,
      ...b,
      ...links,
      ...linked.laws.map((l) => ({ ...l, name: "residual_link_spec_precondition" })),
    ],
    supports: baseSupport,
    polynomial: true,
    search: () => ({ ms: 20000, nodes: 512, products: 30000, rows: 60000 }),
  },
  {
    name: "residual_link_tail_consequences",
    from: "residual_link_model",
    laws: [...tailConsequences, ready],
    supports: {
      ...taylorTailProofs[1]!.supports,
      residual_link_precision_ready: [
        "residual_link_checkpoint",
        "residual_link_index",
        "taylor_tail_prefix",
        "taylor_tail_phase",
      ],
    },
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 24000, rows: 48000, linearProducts: true }),
  },
  {
    name: "residual_link_future",
    from: "residual_link_model",
    using: ["residual_link_tail_consequences"],
    laws: future,
    supports: taylorTailProofs[2]!.supports,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 24000, rows: 48000, linearProducts: true }),
  },
  {
    name: "residual_link_final",
    from: "residual_link_model",
    using: ["residual_link_tail_consequences", "residual_link_future"],
    laws: [unnormalized, final],
    supports: {
      residual_link_cauchy_precision: [
        "residual_link_precision_ready",
        "residual_link_finite_tail",
        "residual_link_denominator",
        "residual_series_norm_conservation",
        "taylor_tail_all_future_prefixes_cauchy",
        "taylor_tail_checkpoint_lower_conservation",
        "residual_series_denominator",
        "taylor_tail_checkpoint_denominator_positive",
      ],
      residual_link_normalized_precision: [
        "residual_link_precision_ready",
        "residual_link_finite_tail",
        "residual_link_denominator",
        "residual_series_norm_conservation",
        "residual_series_scalar_conservation",
        "taylor_tail_all_future_prefixes_cauchy",
        "taylor_tail_checkpoint_lower_conservation",
        "residual_series_denominator",
        "taylor_tail_checkpoint_denominator_positive",
      ],
    },
    polynomial: true,
    search: () => ({
      ms: 20000,
      nodes: 512,
      products: 30000,
      rows: 60000,
      linearProducts: true,
      degreeLift: 1,
      closureRounds: 1,
    }),
  },
  {
    name: "residual_link_allowed",
    from: "residual_link_model",
    steps: true,
    laws: linked.stepLaws.map((l) => ({ ...l, name: "residual_link_tail_admission" })),
    supports: { residual_link_tail_admission: [] },
    polynomial: true,
    search: () => ({
      ms: 15000,
      nodes: 1024,
      products: 24000,
      rows: 48000,
      degreeLift: 1,
      closureRounds: 1,
    }),
  },
];
export { machine as residualLinkedMachine };
