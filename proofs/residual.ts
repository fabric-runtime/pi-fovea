// Actual binomial inversion: the coefficient of P^k in
// sum(j=0..m) choose(m,j) (P-I)^j is 1 at k=m and zero elsewhere.
// First construct the fixed Pascal/factorial row m, then accumulate the signed
// coefficients of (P-I)^j with those weights. No coefficient is supplied by a caller.
import { rule, nat, when, forall, Term } from "gdp-wired";
import type { Law } from "gdp-wired/machine";
import type { Instances } from "gdp-wired/kernel";
import { pascalLaws } from "./operators.ts";
import { operatorProofs } from "./operator-steps.ts";
import type { ProofClaim, ProofGroup, SupportMap } from "./types.ts";
const one = new Term({ op: "const", value: 1 });
const term = (name: string) => new Term({ op: "var", name });
export const residualBasis = (p: Term, n: Term, d: Term) => d.gt(0).and(p.plus(n).atMost(d));
export const binomialResidual = rule("binomial_residual")
  .params({ order: nat, cutoff: nat, leftCutoff: nat, seriesCutoff: nat })
  .inputs({ basisP: nat, basisN: nat, basisDen: nat })
  .state({
    phase: 0,
    ready: 0,
    row: 0,
    factorial: 1,
    degree: 0,
    power3: 1,
    mass: 0,
    weightedMass: 0,
    subMass: 0,
    evalCursor: 0,
    evalDen: 1,
    evalP: 0,
    evalN: 0,
    evalSlack: 0,
    refP: 0,
    refN: 0,
  })
  .maps({
    B: 0,
    K: 1,
    R: 1,
    I: 0,
    Q: 0,
    C: 0,
    CP: 0,
    CN: 0,
    Positive: 0,
    Negative: 0,
    H: 1,
    U: 0,
    D: 0,
    A: 0,
    TP: 0,
    TN: 0,
  })
  .flags((e) => ({
    evaluate: e.phase.eq(2).and(
      e.evalCursor.atMost(e.order),
      e.basisDen.gt(0),
      e.basisP.plus(e.basisN).atMost(e.basisDen),
      e.order
        .gt(e.cutoff)
        .or(e.order.gt(e.leftCutoff))
        .or(
          e.TP.at(e.evalCursor).eq(
            e.TN.at(e.evalCursor).plus(when(e.evalCursor.eq(e.order), 1, 0)),
          ),
        ),
    ),
  }))
  .step((e) => {
    const build = e.phase.eq(0).and(e.ready.eq(0).or(e.row.lt(e.order)));
    const begin = e.phase.eq(0).and(e.ready.eq(1), e.row.eq(e.order));
    const advance = e.phase.eq(1).and(e.degree.lt(e.order));
    const init = e.ready.eq(0),
      next = e.row.plus(1),
      degree = e.degree.plus(1);
    const nextCoefficient = (k: Term) =>
      when(k.eq(0).or(k.eq(degree)), 1, when(k.lt(degree), e.C.at(k).plus(e.C.at(k.minus(1))), 0));
    const nextPositive = (k: Term) => when(k.gt(0), e.CP.at(k.minus(1)), 0).plus(e.CN.at(k));
    const nextNegative = (k: Term) => when(k.gt(0), e.CN.at(k.minus(1)), 0).plus(e.CP.at(k));
    const selected = degree.atMost(e.cutoff).and(e.order.atMost(e.leftCutoff.plus(degree)));
    const nextPrefix = (k: Term) => e.D.at(k).plus(when(k.gt(0), e.D.at(k.minus(1)), 0));
    return {
      phase: when(
        begin,
        when(e.order.eq(0), 2, 1),
        when(advance.and(degree.eq(e.order)), 2, e.phase),
      ),
      ready: when(build, 1, e.ready),
      row: when(build, when(init, 0, next), e.row),
      factorial: when(build, when(init, 1, next.mul(e.factorial)), e.factorial),
      degree: when(advance, degree, e.degree),
      power3: when(build, when(init, 1, e.power3.times(3)), e.power3),
      mass: when(begin, 1, when(advance, e.mass.times(2), e.mass)),
      weightedMass: when(
        begin,
        1,
        when(advance, e.weightedMass.plus(e.B.at(degree).mul(e.mass.times(2))), e.weightedMass),
      ),
      subMass: when(
        begin,
        when(e.order.atMost(e.leftCutoff), 1, 0),
        when(advance.and(selected), e.subMass.plus(e.B.at(degree).mul(e.mass.times(2))), e.subMass),
      ),
      evalCursor: when(e.evaluate, e.evalCursor.plus(1), e.evalCursor),
      evalDen: when(e.evaluate, e.evalDen.mul(e.basisDen), e.evalDen),
      evalP: when(
        e.evaluate,
        e.evalP
          .mul(e.basisDen)
          .plus(
            e.TP.at(e.evalCursor)
              .mul(e.basisP)
              .plus(e.TN.at(e.evalCursor).mul(e.basisN))
              .mul(e.evalDen),
          ),
        e.evalP,
      ),
      evalN: when(
        e.evaluate,
        e.evalN
          .mul(e.basisDen)
          .plus(
            e.TN.at(e.evalCursor)
              .mul(e.basisP)
              .plus(e.TP.at(e.evalCursor).mul(e.basisN))
              .mul(e.evalDen),
          ),
        e.evalN,
      ),
      evalSlack: when(
        e.evaluate,
        e.evalSlack.mul(e.basisDen).plus(
          e.TP.at(e.evalCursor)
            .plus(e.TN.at(e.evalCursor))
            .mul(e.basisDen.minus(e.basisP.plus(e.basisN)))
            .mul(e.evalDen),
        ),
        e.evalSlack,
      ),
      refP: when(
        e.evaluate,
        e.refP.mul(e.basisDen).plus(when(e.evalCursor.eq(e.order), e.basisP.mul(e.evalDen), 0)),
        e.refP,
      ),
      refN: when(
        e.evaluate,
        e.refN.mul(e.basisDen).plus(when(e.evalCursor.eq(e.order), e.basisN.mul(e.evalDen), 0)),
        e.refN,
      ),
      B: e.B.each((k) =>
        when(
          build,
          when(
            init,
            when(k.eq(0), 1, 0),
            when(
              k.eq(0).or(k.eq(next)),
              1,
              when(k.lt(next), e.B.at(k).plus(e.B.at(k.minus(1))), 0),
            ),
          ),
          e.B.at(k),
        ),
      ),
      K: e.K.each((k) =>
        when(build, when(init, 1, when(k.eq(next), next.mul(e.factorial), e.K.at(k))), e.K.at(k)),
      ),
      R: e.R.each((k) =>
        when(
          build,
          when(init, 1, when(k.atMost(e.row), next.minus(e.I.at(k)).mul(e.R.at(k)), 1)),
          e.R.at(k),
        ),
      ),
      I: e.I.set(
        when(init, 0, next),
        when(build, when(init, 0, next), e.I.at(when(init, 0, next))),
      ),
      Q: e.Q.set(
        when(init, 0, next),
        when(build, when(init, 0, one.minus(e.Q.at(e.row))), e.Q.at(when(init, 0, next))),
      ),
      C: e.C.each((k) =>
        when(begin, when(k.eq(0), 1, 0), when(advance, nextCoefficient(k), e.C.at(k))),
      ),
      CP: e.CP.each((k) =>
        when(begin, when(k.eq(0), 1, 0), when(advance, nextPositive(k), e.CP.at(k))),
      ),
      CN: e.CN.each((k) => when(advance, nextNegative(k), e.CN.at(k))),
      Positive: e.Positive.each((k) =>
        when(
          begin,
          when(k.eq(0), 1, 0),
          e.Positive.at(k).plus(when(advance, e.B.at(degree).mul(nextPositive(k)), 0)),
        ),
      ),
      Negative: e.Negative.each((k) =>
        e.Negative.at(k).plus(when(advance, e.B.at(degree).mul(nextNegative(k)), 0)),
      ),
      // Prefixes make finite sums explicit, including the full row at its tail.
      H: e.H.each((k) =>
        when(build, when(init, 1, when(k.eq(next), e.H.at(e.row).times(2), e.H.at(k))), e.H.at(k)),
      ),
      U: e.U.each((k) =>
        when(
          build,
          when(init, 1, e.U.at(k).plus(when(k.gt(0), e.U.at(k.minus(1)).times(2), 0))),
          e.U.at(k),
        ),
      ),
      D: e.D.each((k) => when(begin, 1, when(advance, nextPrefix(k), e.D.at(k)))),
      TP: e.TP.each((k) =>
        when(
          begin,
          when(e.order.atMost(e.leftCutoff).and(k.eq(0)), 1, 0),
          e.TP.at(k).plus(when(advance.and(selected), e.B.at(degree).mul(nextPositive(k)), 0)),
        ),
      ),
      TN: e.TN.each((k) =>
        e.TN.at(k).plus(when(advance.and(selected), e.B.at(degree).mul(nextNegative(k)), 0)),
      ),
      A: e.A.each((k) =>
        when(
          begin,
          when(e.order.atMost(e.leftCutoff), 1, 0),
          e.A.at(k).plus(when(advance.and(selected), e.B.at(degree).mul(nextPrefix(k)), 0)),
        ),
      ),
    };
  });
const oldLaws = pascalLaws;
export const residualLaws = [
  binomialResidual.law("residual_phase", (e) => e.phase.atMost(2)),
  binomialResidual.law("residual_row_bound", (e) => e.row.atMost(e.order)),
  binomialResidual.law("residual_fixed_row", (e) =>
    e.phase.gt(0).implies(e.row.eq(e.order).and(e.ready.eq(1))),
  ),
  binomialResidual.law("residual_degree", (e) => e.degree.atMost(e.order)),
  binomialResidual.law("residual_complete_degree", (e) =>
    e.phase.eq(2).implies(e.degree.eq(e.order)),
  ),
  binomialResidual.law("residual_before", (e) => e.phase.eq(0).implies(e.degree.eq(0))),
  binomialResidual.law("residual_before_coefficients", (e) =>
    forall((k) =>
      e.phase
        .eq(0)
        .implies(
          e.C.at(k)
            .eq(0)
            .and(
              e.CP.at(k).eq(0),
              e.CN.at(k).eq(0),
              e.Positive.at(k).eq(0),
              e.Negative.at(k).eq(0),
            ),
        ),
    ),
  ),
  binomialResidual.law("residual_pascal_ratio", (e) =>
    forall((k) =>
      e.ready
        .eq(1)
        .and(k.gt(0), k.atMost(e.row))
        .implies(
          k.mul(e.B.at(k)).eq(
            e.row
              .plus(1)
              .minus(k)
              .mul(e.B.at(k.minus(1))),
          ),
        ),
    ),
  ),
  binomialResidual.law("residual_C_first", (e) => e.phase.gt(0).implies(e.C.at(0).eq(1))),
  binomialResidual.law("residual_C_last", (e) => e.phase.gt(0).implies(e.C.at(e.degree).eq(1))),
  binomialResidual.law("residual_C_supported", (e) =>
    forall((k) => e.phase.gt(0).and(k.gt(e.degree)).implies(e.C.at(k).eq(0))),
  ),
  binomialResidual.law("residual_C_ratio", (e) =>
    forall((k) =>
      e.phase
        .gt(0)
        .and(k.gt(0), k.atMost(e.degree))
        .implies(
          k.mul(e.C.at(k)).eq(
            e.degree
              .plus(1)
              .minus(k)
              .mul(e.C.at(k.minus(1))),
          ),
        ),
    ),
  ),
  binomialResidual.law("residual_signed_supported", (e) =>
    forall((k) => k.gt(e.degree).implies(e.CP.at(k).eq(0).and(e.CN.at(k).eq(0)))),
  ),
  binomialResidual.law("residual_signed_edge", (e) =>
    e.phase.gt(0).implies(e.CP.at(e.degree).eq(1).and(e.CN.at(e.degree).eq(0))),
  ),
  binomialResidual.law("residual_signed_mass", (e) =>
    forall((k) => e.phase.gt(0).implies(e.CP.at(k).plus(e.CN.at(k)).eq(e.C.at(k)))),
  ),
  binomialResidual.law("residual_signed_adjacent", (e) =>
    forall((k) =>
      e.phase
        .gt(0)
        .and(k.gt(0), k.atMost(e.degree))
        .implies(
          k
            .mul(e.CP.at(k))
            .plus(
              e.degree
                .plus(1)
                .minus(k)
                .mul(e.CP.at(k.minus(1))),
            )
            .eq(
              k.mul(e.CN.at(k)).plus(
                e.degree
                  .plus(1)
                  .minus(k)
                  .mul(e.CN.at(k.minus(1))),
              ),
            ),
        ),
    ),
  ),
  binomialResidual.law("residual_sums_supported", (e) =>
    forall((k) => k.gt(e.degree).implies(e.Positive.at(k).eq(0).and(e.Negative.at(k).eq(0)))),
  ),
  binomialResidual.law("residual_positive_edge", (e) =>
    e.phase.gt(0).implies(e.Positive.at(e.order).eq(when(e.degree.eq(e.order), 1, 0))),
  ),
  binomialResidual.law("residual_negative_edge", (e) => e.Negative.at(e.order).eq(0)),
  binomialResidual.law("residual_telescoping", (e) =>
    forall((k) =>
      e.phase
        .gt(0)
        .and(k.atMost(e.degree))
        .implies(
          e.order
            .minus(k)
            .mul(e.Positive.at(k))
            .plus(e.order.minus(e.degree).mul(e.B.at(e.degree)).mul(e.CN.at(k)))
            .eq(
              e.order
                .minus(k)
                .mul(e.Negative.at(k))
                .plus(e.order.minus(e.degree).mul(e.B.at(e.degree)).mul(e.CP.at(k))),
            ),
        ),
    ),
  ),
  binomialResidual.law("residual_mass_H_first", (e) => e.H.at(0).eq(1)),
  binomialResidual.law("residual_mass_H_adjacent", (e) =>
    forall((k) =>
      e.ready
        .eq(1)
        .and(k.gt(0), k.atMost(e.row))
        .implies(e.H.at(k).eq(e.H.at(k.minus(1)).times(2))),
    ),
  ),
  binomialResidual.law("residual_mass_U_first", (e) => e.ready.eq(1).implies(e.U.at(0).eq(1))),
  binomialResidual.law("residual_mass_U_prefix", (e) =>
    forall((k) =>
      e.ready
        .eq(1)
        .and(k.gt(0), k.atMost(e.row))
        .implies(e.U.at(k).eq(e.U.at(k.minus(1)).plus(e.B.at(k).mul(e.H.at(k))))),
    ),
  ),
  binomialResidual.law("residual_mass_U_tail", (e) =>
    forall((k) => e.ready.eq(1).and(k.atLeast(e.row)).implies(e.U.at(k).eq(e.power3))),
  ),
  binomialResidual.law("residual_mass_before", (e) =>
    e.phase.eq(0).implies(e.mass.eq(0).and(e.weightedMass.eq(0), e.subMass.eq(0))),
  ),
  binomialResidual.law("residual_mass_before_maps", (e) =>
    forall((k) =>
      e.phase
        .eq(0)
        .implies(e.D.at(k).eq(0).and(e.A.at(k).eq(0), e.TP.at(k).eq(0), e.TN.at(k).eq(0))),
    ),
  ),
  binomialResidual.law("residual_mass_D_first", (e) =>
    e.phase.gt(0).implies(e.D.at(0).eq(e.C.at(0))),
  ),
  binomialResidual.law("residual_mass_D_prefix", (e) =>
    forall((k) =>
      e.phase
        .gt(0)
        .and(k.gt(0))
        .implies(e.D.at(k).eq(e.D.at(k.minus(1)).plus(e.C.at(k)))),
    ),
  ),
  binomialResidual.law("residual_mass_D_tail", (e) =>
    forall((k) => e.phase.gt(0).and(k.atLeast(e.degree)).implies(e.D.at(k).eq(e.mass))),
  ),
  binomialResidual.law("residual_mass_power", (e) =>
    e.phase.gt(0).implies(e.mass.eq(e.H.at(e.degree))),
  ),
  binomialResidual.law("residual_mass_weighted", (e) =>
    e.phase.gt(0).implies(e.weightedMass.eq(e.U.at(e.degree))),
  ),
  binomialResidual.law("residual_mass_subset", (e) => e.subMass.atMost(e.weightedMass)),
  binomialResidual.law("residual_mass_A_first", (e) => e.A.at(0).eq(e.TP.at(0).plus(e.TN.at(0)))),
  binomialResidual.law("residual_mass_A_prefix", (e) =>
    forall((k) =>
      k.gt(0).implies(e.A.at(k).eq(e.A.at(k.minus(1)).plus(e.TP.at(k)).plus(e.TN.at(k)))),
    ),
  ),
  binomialResidual.law("residual_mass_A_tail", (e) =>
    forall((k) => e.phase.gt(0).and(k.atLeast(e.degree)).implies(e.A.at(k).eq(e.subMass))),
  ),
  binomialResidual.law("residual_mass_supported", (e) =>
    forall((k) => k.gt(e.degree).implies(e.TP.at(k).eq(0).and(e.TN.at(k).eq(0)))),
  ),
  binomialResidual.law("residual_mass_low", (e) =>
    forall((k) =>
      e.order
        .atMost(e.leftCutoff)
        .and(e.order.atMost(e.cutoff))
        .implies(
          e.TP.at(k)
            .eq(e.Positive.at(k))
            .and(e.TN.at(k).eq(e.Negative.at(k))),
        ),
    ),
  ),
  binomialResidual.law("residual_mass_single_power", (e) =>
    forall((k) =>
      e.leftCutoff
        .eq(0)
        .and(e.cutoff.atLeast(e.order))
        .implies(
          e.TP.at(k)
            .eq(when(e.phase.gt(0).and(e.degree.eq(e.order)), e.CP.at(k), 0))
            .and(e.TN.at(k).eq(when(e.phase.gt(0).and(e.degree.eq(e.order)), e.CN.at(k), 0))),
        ),
    ),
  ),
  binomialResidual.law("residual_mass_D_zero", (e) =>
    forall((k) =>
      e.phase
        .gt(0)
        .and(k.eq(0))
        .implies(e.D.at(k).eq(e.C.at(k))),
    ),
  ),
  binomialResidual.law("residual_mass_A_zero", (e) =>
    forall((k) => k.eq(0).implies(e.A.at(k).eq(e.TP.at(k).plus(e.TN.at(k))))),
  ),
  binomialResidual.law("residual_eval_cursor", (e) => e.evalCursor.atMost(e.order.plus(1))),
  binomialResidual.law("residual_eval_started", (e) => e.evalCursor.gt(0).implies(e.phase.eq(2))),
  binomialResidual.law("residual_eval_denominator", (e) => e.evalDen.gt(0)),
  binomialResidual.law("residual_eval_conservation", (e) =>
    e.evalP
      .plus(e.evalN)
      .plus(e.evalSlack)
      .eq(when(e.evalCursor.gt(0), e.A.at(e.evalCursor.minus(1)), 0).mul(e.evalDen)),
  ),
  binomialResidual.law("residual_eval_reference", (e) =>
    e.order
      .atMost(e.leftCutoff)
      .and(e.order.atMost(e.cutoff))
      .implies(e.evalP.plus(e.refN).eq(e.evalN.plus(e.refP))),
  ),
];
export const residualIdentity = binomialResidual.law("residual_binomial_cancellation", (e) =>
  forall((k) =>
    e.phase.eq(2).implies(e.Positive.at(k).eq(e.Negative.at(k).plus(when(k.eq(e.order), 1, 0)))),
  ),
);
export const residualEvaluationAvailable = binomialResidual.stepLaw(
  "residual_evaluation_available",
  (e) =>
    e.phase
      .eq(2)
      .and(e.evalCursor.atMost(e.order), residualBasis(e.basisP, e.basisN, e.basisDen))
      .implies(e.evaluate),
);
export const residualResults = [
  binomialResidual.law("residual_absolute_mass_bound", (e) =>
    e.phase.eq(2).implies(e.A.at(e.order).eq(e.subMass).and(e.subMass.atMost(e.power3))),
  ),

  binomialResidual.law("residual_row_value_bound", (e) =>
    e.phase
      .eq(2)
      .and(e.evalCursor.eq(e.order.plus(1)))
      .implies(e.evalP.plus(e.evalN).atMost(e.power3.mul(e.evalDen))),
  ),
  binomialResidual.law("residual_low_row_identity", (e) =>
    e.order
      .atMost(e.leftCutoff)
      .and(e.order.atMost(e.cutoff))
      .implies(e.evalP.plus(e.refN).eq(e.evalN.plus(e.refP))),
  ),
];
const all = [...oldLaws, ...residualLaws];
const extras = [
  "residual_phase",
  "residual_row_bound",
  "residual_fixed_row",
  "residual_degree",
  "residual_complete_degree",
  "residual_before",
  "residual_before_coefficients",
];
const support: SupportMap = Object.fromEntries(
  oldLaws.map((l) => [l.name, operatorProofs[0]!.supports?.[l.name] ?? []]),
);
support.residual_phase = [];
support.residual_row_bound = ["residual_row_bound", "pascal_uninitialized"];
support.residual_fixed_row = ["residual_fixed_row", "residual_row_bound"];
support.residual_degree = ["residual_degree"];
support.residual_complete_degree = ["residual_complete_degree", "residual_before"];
support.residual_before = ["residual_before"];
support.residual_pascal_ratio = [
  "residual_pascal_ratio",
  "pascal_ready_bit",
  "pascal_uninitialized",
  "pascal_first_coefficient",
  "pascal_last_coefficient",
  "pascal_coefficients_supported",
];
support.residual_C_first = ["residual_C_first"];
support.residual_C_last = ["residual_C_last"];
support.residual_C_supported = ["residual_C_supported"];
support.residual_C_ratio = [
  "residual_C_ratio",
  "residual_C_first",
  "residual_C_last",
  "residual_C_supported",
];
support.residual_signed_supported = ["residual_signed_supported"];
support.residual_signed_edge = ["residual_signed_edge", "residual_signed_supported"];
support.residual_signed_mass = [
  "residual_signed_mass",
  "residual_signed_supported",
  "residual_C_supported",
  "residual_C_first",
  "residual_C_last",
  "residual_signed_edge",
];
support.residual_signed_adjacent = [
  "residual_signed_adjacent",
  "residual_signed_supported",
  "residual_signed_edge",
];
support.residual_sums_supported = ["residual_sums_supported", "residual_signed_supported"];
support.residual_positive_edge = [
  "residual_positive_edge",
  "residual_fixed_row",
  "residual_degree",
  "residual_sums_supported",
  "residual_C_last",
  "pascal_last_coefficient",
  "residual_signed_edge",
  "residual_signed_supported",
];
support.residual_negative_edge = [
  "residual_negative_edge",
  "residual_degree",
  "residual_signed_edge",
  "residual_signed_supported",
];
support.residual_telescoping = [
  "residual_telescoping",
  "residual_fixed_row",
  "residual_degree",
  "residual_pascal_ratio",
  "residual_signed_adjacent",
  "residual_signed_supported",
  "residual_sums_supported",
  "pascal_first_coefficient",
];
Object.assign(support, {
  residual_mass_H_first: ["residual_mass_H_first"],
  residual_mass_H_adjacent: [
    "residual_mass_H_adjacent",
    "residual_mass_H_first",
    "pascal_ready_bit",
    "pascal_uninitialized",
  ],
  residual_mass_U_first: ["residual_mass_U_first", "pascal_uninitialized"],
  residual_mass_U_prefix: [
    "residual_mass_U_prefix",
    "residual_mass_U_first",
    "residual_mass_U_tail",
    "residual_mass_H_first",
    "residual_mass_H_adjacent",
    "pascal_coefficients_supported",
    "pascal_first_coefficient",
    "pascal_last_coefficient",
    "pascal_uninitialized",
  ],
  residual_mass_U_tail: ["residual_mass_U_tail", "residual_mass_U_first", "pascal_uninitialized"],
  residual_mass_before: ["residual_mass_before"],
  residual_mass_before_maps: ["residual_mass_before_maps"],
  residual_mass_D_first: ["residual_mass_D_first", "residual_C_first"],
  residual_mass_D_prefix: [
    "residual_mass_D_prefix",
    "residual_mass_D_first",
    "residual_C_first",
    "residual_C_last",
    "residual_C_supported",
  ],
  residual_mass_D_tail: ["residual_mass_D_tail"],
  residual_mass_power: ["residual_mass_power", "residual_mass_H_first", "residual_mass_H_adjacent"],
  residual_mass_weighted: [
    "residual_mass_weighted",
    "residual_mass_power",
    "residual_mass_U_first",
    "residual_mass_U_prefix",
    "residual_mass_H_adjacent",
  ],
  residual_mass_subset: ["residual_mass_subset"],
  residual_mass_A_first: [
    "residual_mass_A_first",
    "residual_mass_D_first",
    "residual_signed_mass",
    "residual_mass_before_maps",
  ],
  residual_mass_A_prefix: [
    "residual_mass_A_prefix",
    "residual_mass_before_maps",
    "residual_mass_D_first",
    "residual_mass_D_prefix",
    "residual_signed_mass",
  ],
  residual_mass_A_tail: [
    "residual_mass_A_tail",
    "residual_mass_D_tail",
    "residual_mass_before_maps",
    "residual_mass_before",
  ],
  residual_mass_supported: ["residual_mass_supported", "residual_signed_supported"],
  residual_mass_low: ["residual_mass_low"],
  residual_mass_single_power: [
    "residual_mass_single_power",
    "residual_before_coefficients",
    "residual_mass_before_maps",
    "residual_fixed_row",
    "pascal_last_coefficient",
  ],
  residual_mass_D_zero: ["residual_mass_D_zero", "residual_C_first"],
  residual_mass_A_zero: [
    "residual_mass_A_zero",
    "residual_mass_D_zero",
    "residual_signed_mass",
    "residual_mass_before_maps",
  ],
  residual_eval_cursor: ["residual_eval_cursor"],
  residual_eval_started: ["residual_eval_started"],
  residual_eval_denominator: ["residual_eval_denominator"],
  residual_eval_conservation: [
    "residual_eval_conservation",
    "residual_eval_started",
    "residual_eval_denominator",
    "residual_mass_A_zero",
    "residual_mass_A_first",
    "residual_mass_A_prefix",
  ],
  residual_eval_reference: ["residual_eval_reference"],
});
for (const law of residualLaws) {
  if (!extras.includes(law.name))
    support[law.name] = [
      ...new Set([
        ...(support[law.name] ?? []),
        ...(law.name.startsWith("residual_mass_") || law.name.startsWith("residual_eval_")
          ? [...extras.filter((n) => n !== "residual_before_coefficients"), "pascal_ready_bit"]
          : extras),
      ]),
    ];
}
function instances(l: ProofClaim): Instances {
  if (l.name.startsWith("pascal_")) return operatorProofs[0]!.instances!(l);
  const k = l.forall
    ? term(l.forall + (l.name === "residual_binomial_cancellation" ? "" : "#"))
    : term("degree");
  const keys =
    l.name.startsWith("residual_eval_") || l.name === "residual_evaluation_available"
      ? [term("evalCursor").e, term("evalCursor").minus(1).e]
      : l.name === "residual_absolute_mass_bound" || l.name === "residual_row_value_bound"
        ? [term("order").e, term("evalCursor").minus(1).e]
        : l.name === "residual_mass_weighted" || l.name === "residual_mass_power"
          ? [term("degree").plus(1).e]
          : l.name === "residual_mass_A_first"
            ? [new Term({ op: "const", value: 0 }).e]
            : l.name.startsWith("residual_mass_")
              ? l.forall
                ? [k.e, k.minus(1).e, k.minus(2).e]
                : [
                    term("degree").e,
                    term("degree").plus(1).e,
                    term("order").e,
                    term("row").e,
                    term("row").minus(1).e,
                    new Term({ op: "const", value: 0 }).e,
                  ]
              : l.name.includes("edge")
                ? [
                    term("order").e,
                    term("order").minus(1).e,
                    term("degree").e,
                    term("degree").plus(1).e,
                  ]
                : l.name === "residual_telescoping" || l.name === "residual_binomial_cancellation"
                  ? [k.e]
                  : l.name === "residual_signed_adjacent" || l.name.includes("ratio")
                    ? [k.e, k.minus(1).e, k.minus(2).e]
                    : [k.e, k.minus(1).e];
  const found: Instances = Object.fromEntries(
    all.filter((x) => x.forall).map((x) => [x.name, keys]),
  );
  if (l.name === "residual_telescoping") found.residual_pascal_ratio = [term("degree").plus(1).e];
  return found;
}
export const residualProofs: ProofGroup[] = [
  {
    name: "residual_model",
    machine: binomialResidual.machine,
    laws: all,
    supports: support,
    instances,
    polynomial: true,
    search: (l) =>
      l.name.startsWith("pascal_")
        ? (operatorProofs[0]!.search?.(l) ?? {})
        : l.name.startsWith("residual_eval_")
          ? {
              ms: 20000,
              nodes: 512,
              products: 20000,
              rows: 40000,
              closureRounds: 0,
              degreeLift: 0,
              linearProducts: false,
            }
          : { ms: 15000, nodes: 512, products: 12000, rows: 24000, closureRounds: 0 },
  },
  {
    name: "residual_identity",
    from: "residual_model",
    laws: [residualIdentity, ...residualResults],
    supports: {
      residual_absolute_mass_bound: [
        "residual_complete_degree",
        "residual_fixed_row",
        "residual_mass_A_tail",
        "residual_mass_subset",
        "residual_mass_weighted",
        "residual_mass_U_tail",
      ],
      residual_evaluation_available: [
        "residual_complete_degree",
        "residual_degree",
        "residual_mass_low",
        "residual_telescoping",
        "residual_sums_supported",
        "residual_positive_edge",
        "residual_negative_edge",
      ],
      residual_row_value_bound: [
        "residual_eval_conservation",
        "residual_fixed_row",
        "residual_complete_degree",
        "residual_mass_A_tail",
        "residual_mass_subset",
        "residual_mass_weighted",
        "residual_mass_U_tail",
      ],
      residual_low_row_identity: ["residual_eval_reference"],
      residual_binomial_cancellation: [
        "residual_complete_degree",
        "residual_degree",
        "residual_telescoping",
        "residual_sums_supported",
        "residual_positive_edge",
        "residual_negative_edge",
      ],
    },
    instances,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 12000, rows: 24000, linearProducts: true }),
  },
  {
    name: "residual_evaluation",
    from: "residual_model",
    steps: true,
    laws: [residualEvaluationAvailable],
    supports: {
      residual_evaluation_available: [
        "residual_complete_degree",
        "residual_degree",
        "residual_mass_low",
        "residual_telescoping",
        "residual_sums_supported",
        "residual_positive_edge",
        "residual_negative_edge",
      ],
    },
    instances,
    polynomial: true,
    search: () => ({ ms: 15000, nodes: 512, products: 12000, rows: 24000, linearProducts: true }),
  },
];
export const residualNewNames = [
  ...residualLaws,
  residualIdentity,
  ...residualResults,
  residualEvaluationAvailable,
].map((l) => l.name);
