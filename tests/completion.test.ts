import { describe, expect, it } from "vitest";
import type { E, Law } from "gdp-wired/machine";
import {
  completionLawNames,
  completionProofs,
  continuity,
  continuityLaws,
  equality,
  equalityLaws,
  refinement,
  refinementLaws,
} from "../proofs/completion.ts";
import { checkCompletion } from "../scripts/check-completion.ts";
import { checkProofGroups } from "../scripts/check-streams.ts";
import { condition, exactMachine, type Frame } from "./helpers/natural-machine.js";
const frame = (v: Record<string, bigint>): Frame => ({ v, maps: {}, flags: {} });
const variable = (name: string): E => ({ op: "var", name });
const product = (a: string, b: string): E => ({ op: "prod", a: variable(a), b: variable(b) });

describe("constructive completion certificates", () => {
  it("checks the complete inventory in the existing gdp-wired kernel", () => {
    expect(new Set(completionLawNames).size).toBe(19);
    expect(completionProofs.flatMap((p) => p.laws.map((l) => l.name))).toEqual(completionLawNames);
    expect(checkCompletion()).toBe(19);
  });
  it("constructs nested exact intervals beyond the safe-integer range", () => {
    const model = exactMachine(refinement.machine, refinementLaws);
    for (const width of [0n, 1n, 3n, 2n ** 70n + 1n]) {
      let f = model.initial({ width, precision: 2n });
      for (let k = 0; k < 96; k++) {
        const before = f.v;
        const offset = [0n, width, width / 2n][k % 3]!;
        f = model.advance(f, { offset, checkpoint: BigInt(k % 7 === 0) });
        expect(f.v.scale).toBe(2n ** BigInt(k + 1));
        expect(f.v.lower).toBe(2n * before.lower! + offset);
        expect(f.v.lower! * before.scale!).toBeGreaterThanOrEqual(before.lower! * f.v.scale!);
        expect((f.v.lower! + width) * before.scale!).toBeLessThanOrEqual(
          (before.lower! + width) * f.v.scale!,
        );
        if (f.v.savedIndex! >= 2n * width) {
          expect(
            2n * (f.v.lower! * f.v.savedScale! - f.v.savedLower! * f.v.scale!),
          ).toBeLessThanOrEqual(f.v.scale! * f.v.savedScale!);
        }
      }
      expect(f.v.scale).toBeGreaterThan(2n ** 53n);
    }
  });
  it("refuses enlargement and a denominator that stops growing", () => {
    const escaped = structuredClone(refinement.machine);
    delete escaped.assume;
    expect(() =>
      checkProofGroups([
        { name: "escaped", machine: escaped, laws: refinementLaws, polynomial: true },
      ]),
    ).toThrow("completion_upper_nested");
    const stagnant = structuredClone(refinement.machine);
    stagnant.step.state!.scale = variable("scale");
    expect(() =>
      checkProofGroups([
        { name: "stagnant", machine: stagnant, laws: refinementLaws, polynomial: true },
      ]),
    ).toThrow("completion_scale_growth");
    const model = exactMachine(refinement.machine, refinementLaws);
    expect(() =>
      model.advance(model.initial({ width: 3n, precision: 2n }), { offset: 4n, checkpoint: 0n }),
    ).toThrow("Invalid model input");
  });
  it("matches exact product rectangles and reciprocal widths", () => {
    for (const a of [0n, 7n, 2n ** 80n])
      for (const db of [0n, 3n, 2n ** 65n]) {
        const b = 2n ** 75n + 11n,
          da = 9n,
          denominator = 2n ** 120n;
        const bound = a + da + b + db;
        const precision = 2n ** 20n;
        const f = frame({ a, b, da, db, bound, precision, denominator });
        expect(condition(continuity.machine.pre!, f)).toBe(true);
        for (const l of continuityLaws) expect(condition(l.holds, f), l.name).toBe(true);
        const productWidth = (a + da) * (b + db) - a * b;
        expect(productWidth).toBe(da * (b + db) + a * db);
        expect(productWidth).toBeLessThanOrEqual(bound * (da + db));
        expect(precision * productWidth).toBeLessThanOrEqual(denominator ** 2n);
        for (const scale of [1n, denominator]) {
          const reciprocalPrecision = db ? (b * (b + db)) / (scale * db) : precision;
          const inverseFrame = frame({
            ...f.v,
            denominator: scale,
            precision: reciprocalPrecision,
          });
          expect(condition(continuityLaws[5]!.holds, inverseFrame)).toBe(true);
          expect(reciprocalPrecision * scale * db).toBeLessThanOrEqual(b * (b + db));
        }
      }
  });
  it("rejects discarding the mixed term in a product of approximations", () => {
    const ab = product("a", "b");
    const bad: Law = {
      ...continuityLaws[1]!,
      holds: {
        op: "=",
        a: {
          op: "prod",
          a: { op: "add", a: variable("a"), b: variable("da") },
          b: { op: "add", a: variable("b"), b: variable("db") },
        },
        b: { op: "add", a: ab, b: { op: "add", a: product("da", "b"), b: product("a", "db") } },
      },
    };
    expect(() =>
      checkProofGroups([
        { name: "broken_product", machine: continuity.machine, laws: [bad], polynomial: true },
      ]),
    ).toThrow("completion_product_rectangle_partition");
  });
  it("uses a separating precision rather than accepting any finite number of equal-looking prefixes", () => {
    const denominator = 2n ** 80n + 13n;
    const f = frame({
      x: 100n,
      a: 99n,
      b: 102n,
      y: 103n,
      left: 1n,
      middle: 3n,
      right: 1n,
      gap: 1n,
      denominator,
    });
    for (const l of equalityLaws) expect(condition(l.holds, f), l.name).toBe(true);
    // A positive gap 1/d meets every precision p <= d, but not p=d+1.
    expect(f.v.gap! * denominator).toBeLessThanOrEqual(denominator);
    expect(f.v.gap! * (denominator + 1n)).toBeGreaterThan(denominator);
    const bad: Law = {
      ...equalityLaws[2]!,
      holds: {
        op: "or",
        xs: [
          {
            op: "not",
            x: { op: "<=", a: product("gap", "denominator"), b: variable("denominator") },
          },
          { op: "=", a: variable("gap"), b: { op: "const", value: 0 } },
        ],
      },
    };
    expect(() =>
      checkProofGroups([
        {
          name: "finite_prefix_is_not_equality",
          machine: equality.machine,
          laws: [bad],
          polynomial: true,
        },
      ]),
    ).toThrow("completion_zero_gap_witness");
  });
});
