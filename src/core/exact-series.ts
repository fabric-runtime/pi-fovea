// Positive scalar series over outward-rounded u32 intervals. No Float64 codec.
import {
  add,
  byInt,
  divide,
  geometricTail,
  mul,
  SCALE,
  FIXED_BITS,
  type Interval,
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
const TARGET = shiftRight(SCALE, 100);
const smallTail = (next: Words, ratio: Words): Words | undefined => {
  if (compareWords(ratio, SCALE) >= 0) return undefined;
  const denominator = subtractWords(SCALE, ratio),
    numerator = shiftLeft(next, FIXED_BITS);
  if (compareWords(numerator, multiplyWords(TARGET, denominator)) > 0) return undefined;
  return geometricTail(next, ratio);
};
export function positiveSeries(initial: Interval, ratio: (index: number) => Interval): Interval {
  let term = initial,
    sum = initial;
  for (let index = 0; index < 512; index++) {
    const r = ratio(index),
      next = mul(term, r),
      remainder = smallTail(next[1], r[1]);
    if (remainder !== undefined) return [sum[0], addWords(sum[1], remainder)];
    term = next;
    sum = add(sum, term);
  }
  throw new RangeError("Scalar series certificate did not converge within its work cap");
}
export const expNegativeFixed = (time: Interval): Interval =>
  divide(
    [SCALE, SCALE],
    positiveSeries([SCALE, SCALE], (index) => byInt(time, index + 1)),
  );
