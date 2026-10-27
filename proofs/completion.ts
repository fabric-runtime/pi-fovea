// Finite certificates used to construct and compare limits of rational names.
// These prove shrinking nested enclosures and continuity/error algebra. They do
// NOT yet identify an operator-series limit with the matrix exponential.
import { rule, nat, bool, when, Term } from "gdp-wired";
import type { Law } from "gdp-wired/machine";
import type { ProofGroup } from "./types.ts";

// I_k = [lower/scale, (lower + width)/scale]. Each input chooses a
// half-width subinterval. A fixed signed rational offset may be added to every
// endpoint without changing any nesting, width or distance statement here.
export const refinement = rule("completion_refinement")
  .params({ width: nat, precision: nat })
  .inputs({ offset: nat, checkpoint: bool })
  .state({ index: 0, lower: 0, scale: 1, savedIndex: 0, savedLower: 0, savedScale: 1 })
  .assume((e) => e.offset.atMost(e.width))
  .step((e) => ({
    index: e.index.plus(1),
    lower: e.lower.times(2).plus(e.offset),
    scale: e.scale.times(2),
    savedIndex: when(e.checkpoint, e.index, e.savedIndex),
    savedLower: when(e.checkpoint, e.lower, e.savedLower),
    savedScale: when(e.checkpoint, e.scale, e.savedScale),
  }));
export const refinementLaws = [
  refinement.law("completion_scale_positive", (e) => e.scale.gt(0)),
  refinement.law("completion_scale_growth", (e) => e.scale.atLeast(e.index.plus(1))),
  refinement.law("completion_saved_scale_positive", (e) => e.savedScale.gt(0)),
  refinement.law("completion_saved_index", (e) => e.savedIndex.atMost(e.index)),
  refinement.law("completion_saved_scale", (e) => e.savedScale.atMost(e.scale)),
  refinement.law("completion_lower_nested", (e) =>
    e.savedLower.mul(e.scale).atMost(e.lower.mul(e.savedScale)),
  ),
  refinement.law("completion_upper_nested", (e) =>
    e.lower.plus(e.width).mul(e.savedScale).atMost(e.savedLower.plus(e.width).mul(e.scale)),
  ),
  refinement.law("completion_saved_scale_growth", (e) =>
    e.savedScale.atLeast(e.savedIndex.plus(1)),
  ),
];
const t = (name: string) => new Term({ op: "var", name });
const law = (name: string, holds: ReturnType<Term["eq"]>): Law => ({ name, holds: holds.c });
export const refinementConsequences = [
  law(
    "completion_explicit_modulus",
    t("index")
      .atLeast(t("precision").mul(t("width")))
      .implies(t("precision").mul(t("width")).atMost(t("scale"))),
  ),
  // A stored checkpoint encloses every future interval. Its width is <= 1/p
  // after the explicit checkpoint index p*width, with no maximum p or index.
  law(
    "completion_all_future_lower_distance",
    t("savedIndex")
      .atLeast(t("precision").mul(t("width")))
      .implies(
        t("precision")
          .mul(t("lower"))
          .mul(t("savedScale"))
          .atMost(
            t("precision")
              .mul(t("savedLower"))
              .mul(t("scale"))
              .plus(t("scale").mul(t("savedScale"))),
          ),
      ),
  ),
];

// Nonnegative enclosures [a,a+da]/d and [b,b+db]/d. Common denominators
// are exact: there is no floating-point rounding or bounded word arithmetic.
export const continuity = rule("completion_continuity")
  .params({ a: nat, b: nat, da: nat, db: nat, bound: nat, precision: nat, denominator: nat })
  .pre((e) => e.denominator.gt(0))
  .state({})
  .step(() => ({}));
export const continuityLaws = [
  continuity.law("completion_addition_width", (e) =>
    e.a
      .plus(e.da)
      .plus(e.b.plus(e.db))
      .eq(e.a.plus(e.b).plus(e.da.plus(e.db))),
  ),
  // Exact partition of a product rectangle into its kept rectangle and tails.
  continuity.law("completion_product_rectangle_partition", (e) =>
    e.a
      .plus(e.da)
      .mul(e.b.plus(e.db))
      .eq(
        e.a
          .mul(e.b)
          .plus(e.da.mul(e.b.plus(e.db)))
          .plus(e.a.mul(e.db)),
      ),
  ),
  continuity.law("completion_product_tail_bound", (e) =>
    e.a
      .plus(e.da)
      .atMost(e.bound)
      .and(e.b.plus(e.db).atMost(e.bound))
      .implies(
        e.da
          .mul(e.b.plus(e.db))
          .plus(e.a.mul(e.db))
          .atMost(e.bound.mul(e.da.plus(e.db))),
      ),
  ),
  continuity.law("completion_product_precision", (e) =>
    e.a
      .plus(e.da)
      .atMost(e.bound)
      .and(
        e.b.plus(e.db).atMost(e.bound),
        e.precision.mul(e.bound).mul(e.da.plus(e.db)).atMost(e.denominator.mul(e.denominator)),
      )
      .implies(
        e.precision
          .mul(e.a.plus(e.da).mul(e.b.plus(e.db)))
          .atMost(e.precision.mul(e.a).mul(e.b).plus(e.denominator.mul(e.denominator))),
      ),
  ),
  // Width of [d/(b+db),d/b] is d*db/(b*(b+db)); b>0 is essential.
  continuity.law("completion_reciprocal_denominator", (e) =>
    e.b.gt(0).implies(e.b.mul(e.b.plus(e.db)).gt(0)),
  ),
  continuity.law("completion_reciprocal_precision", (e) =>
    e.b
      .gt(0)
      .and(
        e.precision
          .mul(e.denominator)
          .mul(e.db)
          .atMost(e.b.mul(e.b.plus(e.db))),
      )
      .implies(
        e.precision
          .mul(e.denominator)
          .mul(e.b.plus(e.db))
          .atMost(
            e.precision
              .mul(e.denominator)
              .mul(e.b)
              .plus(e.b.mul(e.b.plus(e.db))),
          ),
      ),
  ),
];

// Finite error composition, to be instantiated at every requested precision.
// An instantiation is NOT itself a proof that two infinite series are equal.
export const equality = rule("completion_equality")
  .params({
    x: nat,
    y: nat,
    a: nat,
    b: nat,
    left: nat,
    middle: nat,
    right: nat,
    gap: nat,
    denominator: nat,
  })
  .state({})
  .step(() => ({}));
export const equalityLaws = [
  equality.law("completion_error_triangle", (e) =>
    e.x
      .atMost(e.a.plus(e.left))
      .and(
        e.a.atMost(e.x.plus(e.left)),
        e.a.atMost(e.b.plus(e.middle)),
        e.b.atMost(e.a.plus(e.middle)),
        e.b.atMost(e.y.plus(e.right)),
        e.y.atMost(e.b.plus(e.right)),
      )
      .implies(
        e.x
          .atMost(e.y.plus(e.left).plus(e.middle).plus(e.right))
          .and(e.y.atMost(e.x.plus(e.left).plus(e.middle).plus(e.right))),
      ),
  ),
  // A nonzero rational gap g/d is separated at the explicit integer precision
  // d+1. If a bound holds at EVERY precision, this witness forces g=0.
  equality.law("completion_rational_separation", (e) =>
    e.gap.gt(0).implies(e.gap.mul(e.denominator.plus(1)).gt(e.denominator)),
  ),
  equality.law("completion_zero_gap_witness", (e) =>
    e.gap.mul(e.denominator.plus(1)).atMost(e.denominator).implies(e.gap.eq(0)),
  ),
];
export const completionProofs: ProofGroup[] = [
  {
    name: "completion_refinement",
    machine: refinement.machine,
    laws: refinementLaws,
    polynomial: true,
  },
  {
    name: "completion_refinement_consequences",
    from: "completion_refinement",
    laws: refinementConsequences,
    polynomial: true,
  },
  {
    name: "completion_continuity",
    machine: continuity.machine,
    laws: continuityLaws,
    polynomial: true,
  },
  { name: "completion_equality", machine: equality.machine, laws: equalityLaws, polynomial: true },
];
export const completionLawNames = completionProofs.flatMap((p) => p.laws.map((l) => l.name));
