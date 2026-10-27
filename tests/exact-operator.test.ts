import { describe, it, expect } from "vitest";
import { ExactSparseOperator, ExactWork, MAX_EXACT_WORDS } from "../src/core/exact-operator.js";
import { solveHeat, certifyHeat } from "../src/core/heat-certificate.js";
import { solveDiffusion } from "../src/substrate.js";
import { fixed, signedBounds } from "../src/core/interval.js";
import { word } from "../src/core/u32.js";
import { sparseEdgeStep } from "../src/verified/generated/limbs.js";
import { sparseEdge, limbLaws, limbs } from "../proofs/limbs.ts";
import { proveDecision, crossCheckDecision } from "gdp-wired";
import type { Csr } from "../src/core/heat.js";
const pair = (): Csr => ({
  n: 2,
  rowPtr: new Uint32Array([0, 1, 2]),
  col: new Uint32Array([1, 0]),
  w: new Float64Array([1, 1]),
  deg: new Float64Array([NaN, NaN]),
});
const signed = (values: number[]) => ({
  positive: values.map((x) => fixed(Math.max(x, 0))),
  negative: values.map((x) => fixed(Math.max(-x, 0))),
});
describe("authoritative exact sparse core", () => {
  it("checks the executed edge transition laws", () => {
    const laws = limbLaws(limbs).filter((l) => l.name.startsWith("sparse_edge_"));
    expect(laws).toHaveLength(7);
    for (const law of laws) {
      const result = proveDecision(law);
      expect(result.proven && result.checked).toBe(true);
      expect(crossCheckDecision(law).failure).toBeUndefined();
    }
  });
  it("refuses a generated transition that fails to advance", () => {
    const broken = sparseEdge.returns((e) => ({
      admit: e.row.lt(e.nodes).and(e.to.lt(e.nodes), e.at.lt(e.end), e.end.atMost(e.total)),
      next: e.at,
      origin: e.row,
      destination: e.to,
    }));
    const law = limbLaws({ ...limbs, sparseEdge: broken }).find(
      (l) => l.name === "sparse_edge_advances",
    )!;
    expect(proveDecision(law).proven).toBe(false);
  });
  it("uses the same generated step for gather and scatter and refuses bad edges", () => {
    expect(sparseEdgeStep(1, 3, 2, 4, 4, 0, true)).toEqual({
      admit: true,
      next: 3,
      origin: 1,
      destination: 0,
    });
    expect(sparseEdgeStep(1, 3, 2, 4, 4, 0, false)).toEqual({
      admit: true,
      next: 3,
      origin: 0,
      destination: 1,
    });
    for (const args of [
      [1, 3, 4, 4, 4, 0],
      [1, 3, 2, 5, 4, 0],
      [1, 3, 2, 4, 4, 3],
      [3, 3, 2, 4, 4, 0],
    ]) {
      const [row, n, at, end, total, to] = args as [number, number, number, number, number, number];
      const result = sparseEdgeStep(row, n, at, end, total, to, true);
      expect(result.admit).toBe(false);
      expect(result.next).toBe(at);
    }
  });
  it("owns exact rational CSR inputs and preserves signed gather/scatter semantics", () => {
    const numerator = word(1);
    const rows = [
      {
        identity: false,
        denominator: word(2),
        entries: [
          { to: 0, numerator },
          { to: 1, numerator },
        ],
      },
      { identity: true, denominator: word(1), entries: [{ to: 1, numerator: word(1) }] },
    ];
    const work = new ExactWork();
    const op = new ExactSparseOperator(rows, work);
    numerator[0] = 99;
    rows[0]!.denominator[0] = 99;
    for (const mode of ["forward", "focus"] as const) {
      const out = op.apply(signed([2, -1]), mode, work);
      const expected = mode === "forward" ? [1, 0] : [0.5, -1];
      for (let i = 0; i < 2; i++) {
        const bounds = signedBounds(out.positive[i]!, out.negative[i]!);
        expect(bounds.lower).toBeLessThanOrEqual(expected[i]!);
        expect(bounds.upper).toBeGreaterThanOrEqual(expected[i]!);
      }
    }
  });
  it("encloses independent exact rational matrix products, not just dyadic rows", () => {
    const integer = (words: Uint32Array) =>
      Array.from(words).reduceRight((sum, x) => (sum << 32n) + BigInt(x), 0n);
    const scale = 1n << 192n;
    for (let a = 1; a <= 4; a++)
      for (let b = 2; b <= 5; b++) {
        const d = a + b,
          work = new ExactWork(),
          op = new ExactSparseOperator(
            [
              {
                identity: false,
                denominator: word(d),
                entries: [
                  { to: 0, numerator: word(a) },
                  { to: 1, numerator: word(b) },
                ],
              },
              { identity: true, denominator: word(1), entries: [{ to: 1, numerator: word(1) }] },
            ],
            work,
          );
        for (const mode of ["forward", "focus"] as const) {
          const out = op.apply(signed([-7, 3]), mode, work),
            expected = mode === "forward" ? [-7 * a, 3 * d - 7 * b] : [-7 * a + 3 * b, 3 * d];
          for (let i = 0; i < 2; i++) {
            const low = integer(out.positive[i]![0]) - integer(out.negative[i]![1]);
            const high = integer(out.positive[i]![1]) - integer(out.negative[i]![0]);
            expect(low * BigInt(d) <= BigInt(expected[i]!) * scale).toBe(true);
            expect(high * BigInt(d) >= BigInt(expected[i]!) * scale).toBe(true);
            expect(high - low <= 20n).toBe(true);
          }
        }
      }
  });
  it("refuses invalid rational rows, limb overflow and exhausted budgets", () => {
    expect(
      () =>
        new ExactSparseOperator(
          [{ identity: false, denominator: word(2), entries: [{ to: 0, numerator: word(1) }] }],
          new ExactWork(),
        ),
    ).toThrow(/mass/);
    expect(
      () =>
        new ExactSparseOperator(
          [{ identity: false, denominator: word(0), entries: [] }],
          new ExactWork(),
        ),
    ).toThrow(/denominator/);
    expect(
      () =>
        new ExactSparseOperator(
          [{ identity: false, denominator: new Uint32Array(MAX_EXACT_WORDS + 1), entries: [] }],
          new ExactWork(),
        ),
    ).toThrow(/capacity/);
    const budget = new ExactWork(1);
    budget.charge(1);
    expect(() => budget.charge(1)).toThrow(/cap/);
    expect(budget.used).toBe(1);
  });
  it("solves without using the corrupted Float64 degree data", () => {
    for (const time of [0, 0.5, 8, 64]) {
      const result = solveHeat(pair(), new Float64Array([1, -0.25]), time);
      const delta = 0.625 * Math.exp(-2 * time),
        expected = [0.375 + delta, 0.375 - delta];
      expect(result.precisionBits).toBe(192);
      expect(result.withinTolerance).toBe(true);
      for (let i = 0; i < 2; i++) {
        expect(result.lower[i]).toBeLessThanOrEqual(expected[i]!);
        expect(result.upper[i]).toBeGreaterThanOrEqual(expected[i]!);
        expect(result.value[i]).toBeGreaterThanOrEqual(result.lower[i]!);
        expect(result.value[i]).toBeLessThanOrEqual(result.upper[i]!);
      }
    }
    expect(certifyHeat(pair(), new Float64Array([1, 0]), 1).withinTolerance).toBe(false);
  });
  it("preserves extreme dyadic weights and fails closed below its precision", () => {
    for (const weight of [Number.MIN_VALUE, Number.MAX_VALUE]) {
      const csr = pair();
      csr.w.fill(weight);
      expect(solveHeat(csr, new Float64Array([1, 0]), 1).withinTolerance).toBe(true);
    }
    expect(() =>
      solveHeat(pair(), new Float64Array([1, 0]), 1, { absoluteTolerance: 1e-100 }),
    ).toThrow(/precision/);
    expect(() => solveHeat(pair(), new Float64Array([1, 0]), 1, { maxWork: 2 })).toThrow(
      /budget|cap/,
    );
  });
  it("exposes the direct solve through the session-free substrate", async () => {
    const graph = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ a: 0, b: 1, w: 1, kind: "invokes" }],
      byName: new Map(),
      byFile: new Map(),
      anchors: [],
      files: [],
    } as unknown as Parameters<typeof solveDiffusion>[0];
    const result = await solveDiffusion(graph, new Float64Array([1, 0]), 1);
    expect(result.withinTolerance).toBe(true);
    await expect(solveDiffusion(graph, new Float64Array([-1, 0]), 1)).rejects.toThrow();
  });
});
