import { describe, expect, it, vi } from "vitest";
import type { Law, Machine } from "gdp-wired/machine";
import type { StepLaw } from "gdp-wired/kernel";
import { normalizeDyadicRow } from "../src/core/normalization.js";
import { divide, SCALE } from "../src/core/interval.js";
import { exactMachine, type Frame } from "./helpers/natural-machine.js";
interface Group {
  name: string;
  machine: Machine;
  laws: Law[];
}
const { normalizationProofs, normalizationLaws, normalizationResults, normalizationSteps } =
  await vi.importActual<{
    normalizationProofs: Group[];
    normalizationLaws: Law[];
    normalizationResults: StepLaw[];
    normalizationSteps: StepLaw[];
  }>("../proofs/normalization.ts");
const { focus, focusLaws } = await vi.importActual<{
  focus: { machine: Machine };
  focusLaws: Law[];
}>("../proofs/focus.ts");
const { transport, transportLaws } = await vi.importActual<{
  transport: { withSumsOf: (...laws: Law[]) => { machine: Machine } };
  transportLaws: Law[];
}>("../proofs/transport.ts");
const { checkProofGroups } = await vi.importActual<{
  checkProofGroups: (groups: unknown[]) => number;
}>("../scripts/check-streams.ts");
const model = normalizationProofs[0]!,
  normal = exactMachine(model.machine, normalizationLaws);
const words = (a: Uint32Array) => [...a].reduceRight((n, w) => (n << 32n) + BigInt(w), 0n);
const abs = (x: bigint) => (x < 0n ? -x : x);
// Independent BigInt IEEE decoder: production uses two u32 halves and limb shifts.
function binary(x: number): [bigint, number] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0),
    exp = Number((bits >> 52n) & 2047n);
  return [(bits & ((1n << 52n) - 1n)) + (exp ? 1n << 52n : 0n), exp ? exp - 1075 : -1074];
}
function query(f: Frame, index: number) {
  // These are before-state arbitrary-index corollaries; evaluate through the
  // independent condition interpreter, not a runtime proof-result boolean.
  return { ...f, v: { ...f.v, at: BigInt(index) } };
}
const action = (f: Frame, op: number, at = 0, value = 0n) =>
  normal.advance(f, { action: BigInt(op), at: BigInt(at), value });
function current(f: Frame, size: number) {
  const prefix = f.v.phase === 0n ? "A" : "B";
  return Array.from(
    { length: size },
    (_, i) =>
      (f.maps[prefix + ".p"]!.get(BigInt(i)) ?? 0n) - (f.maps[prefix + ".n"]!.get(BigInt(i)) ?? 0n),
  );
}
describe("exact row normalization and protocol bridge", () => {
  it("matches independent binary fractions for zeros, duplicate neighbors, extremes and subnormals", () => {
    for (const weights of [
      [0, 0],
      [0.1, 0.2, 0.7, 0],
      [Number.MIN_VALUE, 3 * Number.MIN_VALUE],
      [Number.MIN_VALUE, 1, Number.MAX_VALUE],
    ]) {
      const row = normalizeDyadicRow(
        2,
        new Uint32Array(weights.map(() => 1)),
        new Float64Array(weights),
      );
      const total = words(row.denominator);
      expect(total > 0n).toBe(true);
      expect(row.entries.reduce((n, x) => n + words(x.numerator), 0n)).toBe(total);
      if (weights.every((x) => x === 0)) {
        expect(row.identity).toBe(true);
        expect(row.entries[0]!.to).toBe(2);
        continue;
      }
      const decoded = weights.filter((x) => x > 0).map(binary),
        exponent = Math.min(...decoded.map((x) => x[1]));
      const raw = decoded.map(([n, e]) => n << BigInt(e - exponent)),
        sum = raw.reduce((a, b) => a + b, 0n);
      for (const [i, entry] of row.entries.entries()) {
        const n = words(entry.numerator);
        expect(n * sum).toBe(raw[i]! * total);
        const interval = divide(
          [entry.numerator, entry.numerator],
          [row.denominator, row.denominator],
        );
        expect(words(interval[0]) * total <= n * words(SCALE)).toBe(true);
        expect(n * words(SCALE) <= words(interval[1]) * total).toBe(true);
      }
    }
  });
  it("replays actual rows through the proved normalizer at common-denominator scales", async () => {
    const { condition } = await import("./helpers/natural-machine.js");
    for (const weights of [
      [0, 0],
      [0.1, 0.2, 0.7],
      [Number.MIN_VALUE, Number.MAX_VALUE],
    ])
      for (const scale of [1n, 7n]) {
        const row = normalizeDyadicRow(
          2,
          new Uint32Array(weights.map(() => 1)),
          new Float64Array(weights),
        );
        let f = normal.initial({ self: 99n, scale });
        if (!row.identity)
          for (const [i, x] of row.entries.entries()) f = action(f, 0, i, words(x.numerator));
        f = action(f, 1);
        if (!row.identity)
          for (const [i] of row.entries.entries()) {
            const context = query(f, i),
              budget = normalizationSteps.find((x) => x.name === "normalization_emit_budget")!;
            expect(condition(budget.then, context)).toBe(true);
            f = action(f, 2, i);
          }
        f = action(f, 3);
        expect(f.v.denominator).toBe(words(row.denominator) * scale);
        for (const i of [0, 1, 2, 99])
          for (const law of normalizationResults)
            expect(condition(law.then, query(f, i)), law.name).toBe(true);
        const frozen = f.maps.Raw!;
        f = action(f, 0, 0, 123n);
        for (const k of new Set([...frozen.keys(), ...f.maps.Raw!.keys()]))
          expect(f.maps.Raw!.get(k) ?? 0n).toBe(frozen.get(k) ?? 0n);
      }
  });
  it("feeds normalized rows to both indexed protocols and matches independent matrix powers", () => {
    const specs = [
      { to: [0, 1, 1, 2], w: [0.1, 0.2, 0.3, 0.4] },
      { to: [0, 2], w: [2, 1] },
      { to: [], w: [] },
      { to: [3], w: [0] },
    ];
    const rows = specs.map((r, i) =>
      normalizeDyadicRow(i, new Uint32Array(r.to), new Float64Array(r.w)),
    );
    const common = rows.reduce((d, r) => d * words(r.denominator), 1n);
    const kernels = rows.map((r) =>
      r.entries.map((e) => ({
        to: e.to,
        weight: words(e.numerator) * (common / words(r.denominator)),
      })),
    );
    for (const row of kernels) expect(row.reduce((a, e) => a + e.weight, 0n)).toBe(common);
    for (const mode of ["focus", "forward"] as const) {
      const m = mode === "focus" ? focus.machine : transport.withSumsOf(...transportLaws).machine;
      const runner = exactMachine(m, mode === "focus" ? focusLaws : transportLaws);
      let vector = [5n, -3n, 1n, -7n],
        f = runner.initial(
          mode === "focus" ? { divisor: common, size: 4n, inputBound: 7n } : { divisor: common },
        );
      const step = (op: number, at = 0, weight = 0n, magnitude = 0n, negative = false) => {
        f = runner.advance(f, {
          action: BigInt(op),
          at: BigInt(at),
          weight,
          magnitude,
          negative: negative ? 1n : 0n,
        });
      };
      for (const [i, x] of vector.entries()) step(0, i, 0n, abs(x), x < 0n);
      for (let round = 0; round < 3; round++) {
        const expected = [0n, 0n, 0n, 0n];
        for (const [i, row] of kernels.entries()) {
          step(1, i);
          for (const e of row) {
            if (mode === "focus") {
              expected[i] = expected[i]! + e.weight * vector[e.to]!;
              step(2, e.to, e.weight);
            } else {
              expected[e.to] = expected[e.to]! + e.weight * vector[i]!;
              step(2, e.to, e.weight);
            }
          }
          if (mode === "focus") step(3);
        }
        step(mode === "focus" ? 4 : 3);
        vector = expected;
        expect(current(f, 4)).toEqual(expected);
        expect(f.v.denominator).toBe(common ** BigInt(round + 1));
      }
    }
  });
  it("rejects missing copies, broken normalization mass and invalid runtime rows", async () => {
    const { provePolynomial } = await vi.importActual<{
      provePolynomial: (
        goal: unknown,
        until: number,
        trace: undefined,
        options: { degreeLift: number },
      ) => unknown;
    }>("../scripts/prove-polynomial.ts");
    expect(() =>
      provePolynomial({ name: "invalid lift", hyps: [] }, Infinity, undefined, { degreeLift: 3 }),
    ).toThrow("degree lift");
    let f = action(normal.initial({ self: 9n, scale: 1n }), 0, 2, 3n);
    f = action(f, 1);
    f = action(f, 3);
    expect(f.v.phase).toBe(1n);
    const bad = structuredClone(model.machine),
      write = bad.step.maps!.Output!;
    if ("each" in write) throw new Error("Expected point update");
    write.value = { op: "const", value: 0 };
    const law = model.laws.find((l) => l.name === "normalization_mass_conservation")!;
    const helpers = model.laws.filter((l) =>
      ["normalization_loading_isolate", "normalization_loading_output"].includes(l.name),
    );
    expect(() =>
      checkProofGroups([{ ...model, name: "broken", machine: bad, laws: [...helpers, law] }]),
    ).toThrow(law.name);
    expect(() => normalizeDyadicRow(0, new Uint32Array([0]), new Float64Array([-1]))).toThrow(
      /weight/,
    );
    expect(() => normalizeDyadicRow(0, new Uint32Array(), new Float64Array([1]))).toThrow(/row/);
    expect(() => normalizeDyadicRow(-1, new Uint32Array(), new Float64Array())).toThrow(/row/);
    expect(() => normalizeDyadicRow(0, new Uint32Array([0]), new Float64Array([Infinity]))).toThrow(
      /weight/,
    );
  });
});
