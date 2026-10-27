// Checked handoffs: actual polynomial evaluation -> actual series admission,
// and actual indexed stochastic gather -> the evaluator's bounded basis input.
import { Cond, Term, when } from "gdp-wired";
import type { E } from "gdp-wired/machine";
import { binomialResidual, residualProofs, residualLaws, residualBasis } from "./residual.ts";
import { residualSeries } from "./residual-series.ts";
import { residualLinkProofs } from "./residual-link.ts";
import { focus, focusProofs } from "./focus.ts";
import { bindCondition } from "./substitution.ts";
import type { ProofGroup } from "./types.ts";
interface RowFrame {
  order: Term;
  seriesCutoff: Term;
  evalP: Term;
  evalN: Term;
  evalDen: Term;
  refP: Term;
  refN: Term;
  power3: Term;
}
function admission(e: RowFrame, diagonal: boolean): Cond {
  const vars: Record<string, E> = {
    index: e.order.e,
    last: e.order.e,
    cutoff: e.seriesCutoff.e,
    rowP: e.evalP.e,
    rowN: e.evalN.e,
    rowDen: e.evalDen.e,
    refP: (diagonal ? e.refP : e.evalP).e,
    refN: (diagonal ? e.refN : e.evalN).e,
    power3: e.power3.e,
  };
  return new Cond(bindCondition(residualSeries.machine.step.flags!.take!, vars));
}
const cauchy = binomialResidual.law("operator_cauchy_row_admission", (e) =>
  e.phase
    .eq(2)
    .and(e.evalCursor.eq(e.order.plus(1)), e.leftCutoff.eq(e.cutoff), e.seriesCutoff.eq(e.cutoff))
    .implies(admission(e, true)),
);
const taylor = binomialResidual.law("operator_taylor_row_admission", (e) =>
  e.phase
    .eq(2)
    .and(e.evalCursor.eq(e.order.plus(1)), e.leftCutoff.eq(0), e.cutoff.atLeast(e.order))
    .implies(admission(e, false)),
);
const basis = focus.stepLaw("operator_stochastic_basis_admission", (e) => {
  const a = e.A.at(e.at),
    b = e.B.at(e.at);
  return e.inputBound
    .eq(1)
    .implies(
      residualBasis(when(e.phase.eq(0), a.p, b.p), when(e.phase.eq(0), a.n, b.n), e.denominator),
    );
});
const supports = [
  "residual_row_value_bound",
  "residual_low_row_identity",
  "residual_eval_denominator",
];
const t = (name: string) => new Term({ op: "var", name });
export const operatorIdentificationProofs: ProofGroup[] = [
  ...residualProofs,
  {
    name: "operator_row_handoff",
    from: "residual_model",
    using: ["residual_identity"],
    laws: [cauchy, taylor],
    supports: Object.fromEntries([cauchy, taylor].map((l) => [l.name, supports])),
    instances: () =>
      Object.fromEntries(
        residualLaws
          .filter((l) => l.forall)
          .map((l) => [l.name, [t("order").e, t("evalCursor").minus(1).e]]),
      ),
    polynomial: true,
    search: () => ({
      ms: 15000,
      nodes: 512,
      products: 24000,
      rows: 48000,
      linearProducts: true,
      degreeLift: 1,
      closureRounds: 1,
    }),
  },
  ...focusProofs,
  {
    name: "operator_basis_handoff",
    from: "indexed_focus",
    steps: true,
    laws: [basis],
    supports: {
      operator_stochastic_basis_admission: [
        "focus_phase_bit",
        "focus_global_linf_bound",
        "focus_denominator_positive",
      ],
    },
    instances: () => ({ focus_global_linf_bound: [t("at").e] }),
    polynomial: true,
    search: () => ({ ms: 10000, nodes: 512, products: 8000, rows: 16000, linearProducts: true }),
  },
  ...residualLinkProofs,
];
