import { describe, expect, it } from "vitest";
import { besselBounds, scaledBesselBounds, sqrtBounds } from "../src/core/numerics.js";
import { besselI } from "../src/core/heat.js";
// Independent oracle for the dyadic decoder and squaring certificate.
const squareOrder = (candidate: number, x: number): number => {
  const view = new DataView(new ArrayBuffer(8));
  const decode = (value: number) => {
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0),
      e = Number((bits >> 52n) & 2047n);
    return { n: (bits & ((1n << 52n) - 1n)) + (e ? 1n << 52n : 0n), e: e ? e - 1075 : -1074 };
  };
  const a = decode(candidate),
    b = decode(x),
    e = Math.min(2 * a.e, b.e);
  const left = (a.n * a.n) << BigInt(2 * a.e - e),
    right = b.n << BigInt(b.e - e);
  return left === right ? 0 : left < right ? -1 : 1;
};
describe("scalar numerical certificates", () => {
  it("encloses known Bessel values without log/gamma evaluation", () => {
    for (const [k, t, value] of [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 1.2660658777520084],
      [1, 1, 0.565159103992485],
      [2, 1, 0.13574766976703828],
    ] as const) {
      const b = besselBounds(k, t);
      expect(b.lower).toBeLessThanOrEqual(value);
      expect(b.upper).toBeGreaterThanOrEqual(value);
      expect(b.value).toBeGreaterThanOrEqual(b.lower);
      expect(b.value).toBeLessThanOrEqual(b.upper);
    }
    const scaled = scaledBesselBounds(0, 1);
    expect(scaled.lower).toBeLessThanOrEqual(0.46575960759364043);
    expect(scaled.upper).toBeGreaterThanOrEqual(0.46575960759364043);
  });
  it("certifies difficult finite square roots including subnormals", () => {
    for (const x of [0, Number.MIN_VALUE, 1e-300, 0.5, 2, 3, 1e100, Number.MAX_VALUE]) {
      const b = sqrtBounds(x);
      expect(b.lower).toBeLessThanOrEqual(b.value);
      expect(b.upper).toBeGreaterThanOrEqual(b.value);
      expect(b.value).toBe(Math.sqrt(x));
      expect(squareOrder(b.lower, x)).toBeLessThanOrEqual(0);
      expect(squareOrder(b.upper, x)).toBeGreaterThanOrEqual(0);
    }
    expect(() => sqrtBounds(-1)).toThrow();
    expect(() => sqrtBounds(Infinity)).toThrow();
    expect(() => sqrtBounds(NaN)).toThrow();
  });
  it("covers the supported coefficient domain and rejects unbounded work", () => {
    for (const t of [0, 1e-12, 0.5, 2, 8, 32, 64])
      for (const k of [0, 1, 2, 16, 90]) {
        const b = scaledBesselBounds(k, t);
        expect(Number.isFinite(b.value)).toBe(true);
        expect(b.lower).toBeGreaterThanOrEqual(0);
        expect(b.upper).toBeLessThanOrEqual(1 + 1e-14);
      }
    expect(besselI(1, 1e-10)).toBeCloseTo(5e-11, 20);
    expect(() => besselBounds(513, 1)).toThrow();
    expect(() => besselBounds(1, 65)).toThrow();
    expect(() => besselBounds(1, NaN)).toThrow();
  });
});
