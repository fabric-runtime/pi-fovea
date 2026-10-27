import { describe, it, expect } from "vitest";
import { rule, forall, Term } from "gdp-wired";
import { checkProofGroups } from "../scripts/check-streams.ts";
import type { ConsequenceProof, ProofGroup } from "../proofs/types.ts";
const model = rule("quantified_composition_fixture")
  .state({})
  .maps({ M: 0 })
  .step(() => ({}));
const base = model.law("all_cells_zero", (e) => forall((k) => e.M.at(k).eq(0)));
const target = model.law("reindexed_cell_zero", (e) => forall((k) => e.M.at(k.plus(2)).eq(0)));
const term = (name: string) => new Term({ op: "var", name });
const basis: ProofGroup = {
  name: "basis",
  machine: model.machine,
  laws: [base],
  instances: () => ({ all_cells_zero: [term(base.forall! + "#").e] }),
};
const consequence = (offset: number): ConsequenceProof => ({
  name: "consequence",
  from: "basis",
  laws: [target],
  instances: () => ({ all_cells_zero: [term(target.forall!).plus(offset).e] }),
});
describe("quantified proof composition", () => {
  it("instantiates an established invariant at the actual target key", () =>
    expect(checkProofGroups([basis, consequence(2)])).toBe(2));
  it("rejects a fact instantiated at a different key", () =>
    expect(() => checkProofGroups([basis, consequence(3)], { ms: 1000 })).toThrow(
      "reindexed_cell_zero",
    ));
  it("does not treat an uninstantiated quantified fact as an arbitrary free witness", () => {
    const c = consequence(2);
    delete c.instances;
    expect(() => checkProofGroups([basis, c], { ms: 1000 })).toThrow("reindexed_cell_zero");
  });
  it("does not allow a derived group to support itself", () => {
    const c = consequence(2);
    c.using = ["consequence"];
    expect(() => checkProofGroups([basis, c])).toThrow();
  });
});
