// Exact finite-row normalization from raw natural weights. Loading and draining
// are separate phases. The immutable raw map records what the normalized output
// means; scale permits lifting different rows to a common positive denominator.
import { rule, nat, when, forall, Term } from "gdp-wired";
import type { Instances } from "gdp-wired/kernel";
import type { ProofClaim, ProofGroup, SupportMap } from "./types.ts";
const term = (name: string) => new Term({ op: "var", name });
export const normalization = rule("raw_row_normalization")
  .params({ self: nat, scale: nat })
  .pre((e) => e.scale.gt(0))
  .inputs({ action: nat, at: nat, value: nat })
  .state({ phase: 0, isolate: 0, denominator: (e) => e.scale })
  .maps({ Raw: 0, Pending: 0, Output: 0 })
  .flags((e) => ({
    load: e.action.eq(0).and(e.phase.eq(0)),
    freeze: e.action.eq(1).and(e.phase.eq(0)),
    copy: e.action.eq(2).and(e.phase.eq(1)),
    finish: e.action.eq(3).and(e.phase.eq(1), e.Pending.sum().eq(0)),
  }))
  .step((e) => {
    const empty = e.Raw.sum().eq(0),
      fallback = e.freeze.and(empty),
      amount = e.Pending.at(e.at).mul(e.scale);
    const outKey = when(e.action.eq(1), e.self, e.at);
    return {
      phase: when(e.freeze, 1, when(e.finish, 2, e.phase)),
      isolate: when(e.freeze, when(empty, 1, 0), e.isolate),
      denominator: when(e.freeze, when(empty, e.scale, e.Raw.sum().mul(e.scale)), e.denominator),
      Raw: e.Raw.set(e.at, when(e.load, e.Raw.at(e.at).plus(e.value), e.Raw.at(e.at))),
      Pending: e.Pending.set(
        e.at,
        when(e.load, e.Pending.at(e.at).plus(e.value), when(e.copy, 0, e.Pending.at(e.at))),
      ),
      Output: e.Output.set(
        outKey,
        e.Output.at(outKey).plus(when(fallback, e.scale, when(e.copy, amount, 0))),
      ),
    };
  });
export const normalizationLaws = [
  normalization.law("normalization_phase_range", (e) => e.phase.atMost(2)),
  normalization.law("normalization_isolate_bit", (e) => e.isolate.atMost(1)),
  normalization.law("normalization_loading_isolate", (e) => e.phase.eq(0).implies(e.isolate.eq(0))),
  normalization.law("normalization_loading_output", (e) =>
    e.phase.eq(0).implies(e.Output.sum().eq(0)),
  ),
  normalization.law("normalization_denominator_positive", (e) => e.denominator.gt(0)),
  normalization.law("normalization_frozen_denominator", (e) =>
    e.phase.gt(0).implies(e.denominator.eq(e.Raw.sum().plus(e.isolate).mul(e.scale))),
  ),
  normalization.law("normalization_zero_row", (e) =>
    e.phase.gt(0).implies(e.isolate.eq(1).iff(e.Raw.sum().eq(0))),
  ),
  normalization.law("normalization_mass_conservation", (e) =>
    e.Pending.sum().mul(e.scale).plus(e.Output.sum()).eq(e.Raw.sum().plus(e.isolate).mul(e.scale)),
  ),
  normalization.law("normalization_point_correspondence", (e) =>
    forall((k) =>
      e.Pending.at(k)
        .mul(e.scale)
        .plus(e.Output.at(k))
        .eq(
          e.Raw.at(k)
            .mul(e.scale)
            .plus(when(e.isolate.eq(1).and(k.eq(e.self)), e.scale, 0)),
        ),
    ),
  ),
  normalization.law("normalization_completed_pending", (e) =>
    e.phase.eq(2).implies(e.Pending.sum().eq(0)),
  ),
];
// Request `at` is arbitrary: these read-only step claims cover every key,
// while importing already checked invariants instead of reproving transitions.
export const normalizationResults = [
  normalization.stepLaw("normalization_unit_mass", (e) =>
    e.phase.eq(2).implies(e.Output.sum().eq(e.denominator)),
  ),
  normalization.stepLaw("normalization_nonnegative_range", (e) =>
    e.phase.gt(0).implies(e.Output.at(e.at).atMost(e.denominator)),
  ),
  normalization.stepLaw("normalization_raw_ratio", (e) =>
    e.phase
      .eq(2)
      .and(e.isolate.eq(0))
      .implies(e.Output.at(e.at).eq(e.Raw.at(e.at).mul(e.scale))),
  ),
  normalization.stepLaw("normalization_isolate_identity", (e) =>
    e.phase
      .eq(2)
      .and(e.isolate.eq(1))
      .implies(e.Output.at(e.at).eq(when(e.at.eq(e.self), e.scale, 0))),
  ),
  normalization.stepLaw("normalization_ratio_preserved", (e) =>
    e.phase
      .eq(2)
      .and(e.isolate.eq(0))
      .implies(e.Output.at(e.at).mul(e.Raw.sum()).eq(e.Raw.at(e.at).mul(e.denominator))),
  ),
];
export const normalizationSteps = [
  normalization.stepLaw(
    "normalization_emit_budget",
    (a) => a.Output.sum().plus(a.Pending.at(a.at).mul(a.scale)).atMost(a.denominator),
    (e) => e.copy,
  ),
  normalization.stepLaw(
    "normalization_fallback_value",
    (a, b) => b.Output.at(a.self).eq(a.scale),
    (e) => e.freeze.and(e.Raw.sum().eq(0)),
  ),
];
const all = normalizationLaws;
const support: SupportMap = Object.fromEntries(all.map((l) => [l.name, []]));
support.normalization_frozen_denominator = ["normalization_zero_row"];
support.normalization_mass_conservation = [
  "normalization_loading_isolate",
  "normalization_loading_output",
];
support.normalization_point_correspondence = ["normalization_loading_isolate"];
support.normalization_unit_mass = [
  "normalization_mass_conservation",
  "normalization_frozen_denominator",
  "normalization_completed_pending",
];
support.normalization_nonnegative_range = [
  "normalization_mass_conservation",
  "normalization_frozen_denominator",
];
support.normalization_raw_ratio = [
  "normalization_point_correspondence",
  "normalization_completed_pending",
];
support.normalization_isolate_identity = [
  "normalization_point_correspondence",
  "normalization_completed_pending",
  "normalization_zero_row",
];
support.normalization_ratio_preserved = [
  "normalization_point_correspondence",
  "normalization_completed_pending",
  "normalization_frozen_denominator",
];
const machine = normalization.withSumsOf(...all).machine;
const instances = (l: ProofClaim): Instances => {
  const keys = [term("at").e, term("self").e, ...(l.forall ? [term(l.forall + "#").e] : [])];
  return Object.fromEntries([
    ...all.filter((x) => x.forall).map((x) => [x.name, keys]),
    // Instantiate the native sum kernel's quantified cell bounds; these are
    // checked closures, not foreign facts or a new sum axiom.
    ...Object.keys(machine.sums ?? {}).map((name) => ["?cells$" + name, keys]),
  ]);
};
export const normalizationProofs: ProofGroup[] = [
  {
    name: "row_normalization",
    machine,
    laws: all,
    supports: support,
    instances,
    polynomial: [
      "normalization_denominator_positive",
      "normalization_frozen_denominator",
      "normalization_mass_conservation",
    ],
    search: () => ({ nodes: 256, products: 2500, rows: 5000 }),
  },
  {
    name: "normalization_protocol",
    from: "row_normalization",
    steps: true,
    laws: [...normalizationResults, ...normalizationSteps],
    instances,
    polynomial: true,
    search: (l) =>
      l.name === "normalization_ratio_preserved"
        ? { ms: 10000, nodes: 256, products: 12000, rows: 24000, closureRounds: 1, degreeLift: 1 }
        : { nodes: 256, products: 4000, rows: 8000 },
    supports: {
      ...support,
      normalization_emit_budget: [
        "normalization_mass_conservation",
        "normalization_frozen_denominator",
      ],
      normalization_fallback_value: ["normalization_loading_output"],
    },
  },
];
export const normalizationLawNames = normalizationProofs.flatMap((p) => p.laws.map((l) => l.name));
