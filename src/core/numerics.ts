// Positive scalar certificates, using the shared outward u32 interval engine.
import {
  byInt,
  dyadic,
  enclose,
  fixed,
  mul,
  nextDown,
  nextUp,
  SCALE,
  type Interval,
  type NumericBounds,
} from "./interval.js";
import { compareWords, multiplyWords, shiftLeft } from "./u32.js";
import { positiveSeries as sumSeries, expNegativeFixed } from "./exact-series.js";
export type { NumericBounds } from "./interval.js";
interface Coefficients {
  t: Interval;
  inverseExp: Interval;
  values: Map<number, Interval>;
}
const cache = new Map<number, Coefficients>();
const coefficients = (t: number): Coefficients => {
  if (!Number.isFinite(t) || t < 0 || t > 64)
    throw new RangeError("Certified heat time must be in [0,64]");
  const hit = cache.get(t);
  if (hit) {
    cache.delete(t);
    cache.set(t, hit);
    return hit;
  }
  const x = fixed(t);
  const result = {
    t: x,
    inverseExp: expNegativeFixed(x),
    values: new Map<number, Interval>(),
  };
  cache.set(t, result);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return result;
};
const bessel = (k: number, c: Coefficients): Interval => {
  if (!Number.isSafeInteger(k) || k < 0 || k > 512)
    throw new RangeError("Certified Bessel order must be in [0,512]");
  const hit = c.values.get(k);
  if (hit) return hit;
  const half = byInt(c.t, 2),
    square = mul(half, half);
  let initial: Interval = [SCALE, SCALE];
  for (let i = 1; i <= k; i++) initial = byInt(mul(initial, half), i);
  const value = sumSeries(initial, (m) => byInt(square, (m + 1) * (m + k + 1)));
  c.values.set(k, value);
  return value;
};
export const besselBounds = (k: number, t: number): NumericBounds => {
  const c = coefficients(t);
  return enclose(bessel(k, c));
};
export const scaledBesselBounds = (k: number, t: number): NumericBounds => {
  const c = coefficients(t);
  return enclose(mul(bessel(k, c), c.inverseExp));
};
const squareCompare = (candidate: number, x: number): number => {
  const a = dyadic(candidate),
    b = dyadic(x),
    e = Math.min(2 * a.e, b.e);
  return compareWords(shiftLeft(multiplyWords(a.n, a.n), 2 * a.e - e), shiftLeft(b.n, b.e - e));
};
export const sqrtBounds = (x: number): NumericBounds => {
  if (!Number.isFinite(x) || x < 0)
    throw new RangeError("Expected finite nonnegative square root input");
  if (x === 0) return { lower: 0, upper: 0, value: 0 };
  const value = Math.sqrt(x),
    lower = nextDown(value),
    upper = nextUp(value);
  if (squareCompare(lower, x) > 0 || squareCompare(upper, x) < 0)
    throw new RangeError("Host square root failed its exact enclosure certificate");
  return { lower, upper, value };
};
export const certifiedSqrt = (x: number): number => sqrtBounds(x).value;
