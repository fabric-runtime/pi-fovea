// Positive scalar certificates, using the shared outward u32 interval engine.
import {
  add,
  byInt,
  divide,
  dyadic,
  enclose,
  fixed,
  geometricTail,
  mul,
  nextDown,
  nextUp,
  FIXED_BITS,
  SCALE,
  type Interval,
  type NumericBounds,
} from "./interval.js";
import {
  addWords,
  compareWords,
  multiplyWords,
  shiftLeft,
  shiftRight,
  subtractWords,
  type Words,
} from "./u32.js";
export type { NumericBounds } from "./interval.js";
const TARGET = shiftRight(SCALE, 100);
// Subsequent term ratios decrease. Test the exact geometric bound before division.
const smallTail = (next: Words, ratio: Words): Words | undefined => {
  if (compareWords(ratio, SCALE) >= 0) return undefined;
  const denominator = subtractWords(SCALE, ratio),
    numerator = shiftLeft(next, FIXED_BITS);
  if (compareWords(numerator, multiplyWords(TARGET, denominator)) > 0) return undefined;
  return geometricTail(next, ratio);
};
const sumSeries = (initial: Interval, ratio: (m: number) => Interval): Interval => {
  let term = initial,
    sum = initial;
  for (let m = 0; m < 512; m++) {
    const r = ratio(m),
      next = mul(term, r),
      remainder = smallTail(next[1], r[1]);
    if (remainder !== undefined) return [sum[0], addWords(sum[1], remainder)];
    term = next;
    sum = add(sum, term);
  }
  throw new RangeError("Scalar series certificate did not converge within its work cap");
};
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
  const x = fixed(t),
    exp = sumSeries([SCALE, SCALE], (m) => byInt(x, m + 1));
  const result = {
    t: x,
    inverseExp: divide([SCALE, SCALE], exp),
    values: new Map<number, Interval>(),
  };
  cache.set(t, result);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return result;
};
/** Internal immutable interval for exp(-t), shared by the independent Poisson evaluator. */
export const expNegativeInterval = (t: number): Interval => {
  const [lower, upper] = coefficients(t).inverseExp;
  return [lower.slice(), upper.slice()];
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
