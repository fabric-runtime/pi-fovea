import { describe, expect, it } from "vitest";
import {
  add,
  byInt,
  divide,
  fixed,
  mul,
  nextDown,
  nextUp,
  signedBounds,
  type Interval,
} from "../src/core/interval.js";
const integer = (a: Uint32Array): bigint => {
  let n = 0n;
  for (let i = a.length - 1; i >= 0; i--) n = (n << 32n) + BigInt(a[i]!);
  return n;
};
const values = (a: Interval) => a.map(integer) as [bigint, bigint];
const scale = 1n << 192n;
describe("outward interval composition against exact integer arithmetic", () => {
  it("rounds multiply, divide and integer division outwards, including nonexact inputs", () => {
    for (const x of [Number.MIN_VALUE, 0.1, 0.5, 1, 64, 1e50])
      for (const y of [0.3, 2, 17]) {
        const a = fixed(x),
          b = fixed(y),
          [al, au] = values(a),
          [bl, bu] = values(b);
        const product = values(mul(a, b)),
          quotient = values(divide(a, b)),
          sum = values(add(a, b));
        expect(product[0] * scale).toBeLessThanOrEqual(al * bl);
        expect(product[1] * scale).toBeGreaterThanOrEqual(au * bu);
        expect(quotient[0] * bu).toBeLessThanOrEqual(al * scale);
        expect(quotient[1] * bl).toBeGreaterThanOrEqual(au * scale);
        expect(sum).toEqual([al + bl, au + bu]);
        const thirds = values(byInt(a, 3));
        expect(thirds[0] * 3n).toBeLessThanOrEqual(al);
        expect(thirds[1] * 3n).toBeGreaterThanOrEqual(au);
      }
  });
  it("keeps scale changes exact and performs signed cancellation before Float64 conversion", () => {
    expect(values(fixed(Number.MIN_VALUE, 1074))).toEqual([scale, scale]);
    const bounds = signedBounds(fixed(3), fixed(5));
    expect(bounds.lower).toBeLessThan(-2);
    expect(bounds.upper).toBeGreaterThan(-2);
    expect(() => divide(fixed(1), fixed(0))).toThrow();
    expect(() => fixed(-1)).toThrow();
  });
  it("steps representable neighbors in both signs and across zero", () => {
    expect(nextUp(-1)).toBeGreaterThan(-1);
    expect(nextDown(-1)).toBeLessThan(-1);
    expect(nextUp(-Number.MIN_VALUE)).toBe(-0);
    expect(nextDown(Number.MIN_VALUE)).toBe(0);
    expect(nextUp(0)).toBe(Number.MIN_VALUE);
    expect(nextDown(0)).toBe(-Number.MIN_VALUE);
    expect(nextUp(-Infinity)).toBe(-Number.MAX_VALUE);
    expect(nextDown(Infinity)).toBe(Number.MAX_VALUE);
  });
});
