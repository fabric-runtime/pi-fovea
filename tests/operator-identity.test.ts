import { describe, it, expect } from "vitest";
import { cauchyProduct, cauchyProductProofs, productPowers } from "../proofs/cauchy-product.ts";
import { operatorLimitProofs, precisionPlan } from "../proofs/operator-limit.ts";
import { operatorIdentityLawNames } from "../proofs/operator-identity.ts";
import { checkProofGroups } from "../scripts/check-streams.ts";
import type { Law } from "gdp-wired/machine";
describe("constructive operator identification", () => {
  it(
    "checks the finite reindexing and completion certificates",
    () => expect(checkProofGroups([...cauchyProductProofs, ...operatorLimitProofs])).toBe(20),
    30000,
  );
  it("groups every finite signed rectangular product exactly, independent of order", () => {
    for (let N = 0; N <= 6; N++) {
      const requests = Array.from({ length: (N + 1) ** 2 }, (_, k) => {
        const i = Math.floor(k / (N + 1)),
          j = k % (N + 1);
        return { i, j, aP: i + 2, aN: i % 2, bP: j + 3, bN: j % 3 };
      });
      let expectedP = 0n,
        expectedN = 0n;
      const diagonals = new Map<number, bigint>();
      for (const x of requests) {
        const p = BigInt(x.aP * x.bP + x.aN * x.bN),
          n = BigInt(x.aP * x.bN + x.aN * x.bP);
        expectedP += p;
        expectedN += n;
        diagonals.set(x.i + x.j, (diagonals.get(x.i + x.j) ?? 0n) + p - n);
      }
      for (const trace of [requests, [...requests].reverse()]) {
        const run = cauchyProduct.interpreter(),
          params = { cutoff: N };
        let state = run.init(params);
        for (const x of trace) state = run.step(params, state, x);
        expect(BigInt(state.scalars.p!)).toBe(expectedP);
        expect(BigInt(state.scalars.n!)).toBe(expectedN);
        for (const [k, value] of diagonals)
          expect(
            BigInt(state.maps["D.p"]?.get(k) ?? 0) - BigInt(state.maps["D.n"]?.get(k) ?? 0),
          ).toBe(value);
      }
    }
  });
  it("refuses a grouping implementation that changes the sum", () => {
    const laws = cauchyProductProofs[0]!.laws.filter((l): l is Law => "holds" in l);
    const bad = cauchyProduct.step((e) => ({ p: e.p.plus(1) })).withSumsOf(...laws);
    expect(() => checkProofGroups([{ name: "bad", machine: bad.machine, laws }])).toThrow(
      "cauchy_product_positive_pushforward",
    );
  });
  it("constructs the finite precision plan including t=0", () => {
    for (let numerator = 0; numerator <= 2; numerator++) {
      const run = precisionPlan.interpreter(),
        params = { numerator, precision: 7 },
        d = 6 * numerator + 1;
      let s = run.init(params);
      for (let k = 0; k < d; k++) s = run.step(params, s, {});
      expect(s.scalars.index).toBe(d);
      expect(BigInt(s.scalars.power!)).toBe(BigInt(3 * numerator) ** BigInt(d));
      expect(run.step(params, s, {})).toEqual(s);
    }
  });
  it("rejects a nonterminating precision planner", () => {
    const original = operatorLimitProofs[1]!;
    if (!original.loop) throw new Error("Missing termination claim");
    const bad = precisionPlan.step((e) => ({ index: e.index, power: e.power }));
    expect(() =>
      checkProofGroups([
        { ...original, loop: { ...original.loop, body: bad.machine.step.state! } },
      ]),
    ).toThrow();
  });
  it("constructs powers by either multiplication order", () => {
    const run = productPowers.interpreter(),
      params = { base: 3 };
    let s = run.init(params);
    for (const left of [true, false, false, true, true])
      s = run.step(params, s, { left: left ? 1 : 0 });
    expect(s.scalars.a! * s.scalars.b!).toBe(s.scalars.total);
    expect(s.scalars.total).toBe(243);
  });
  it("registers the actual handoffs, arbitrary-prefix bounds, and completion rules", () => {
    for (const name of [
      "operator_cauchy_row_admission",
      "operator_taylor_row_admission",
      "operator_stochastic_basis_admission",
      "cauchy_product_positive_pushforward",
      "operator_limit_three_error_transfer",
      "operator_plan_cutoff_ready",
    ])
      expect(operatorIdentityLawNames).toContain(name);
    expect(new Set(operatorIdentityLawNames).size).toBe(operatorIdentityLawNames.length);
  });
});
