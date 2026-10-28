// Authoritative Poisson enclosure: limb-only values after boundary conversion.
import { add, byInt, geometricTail, mul, ZERO, SCALE, type Interval } from "./interval.js";
import { addWords, compareWords, multiplyWords, word, type Words } from "./u32.js";
import { expNegativeFixed } from "./exact-series.js";
import {
  ExactSparseOperator,
  ExactWork,
  checkInterval,
  checkWords,
  type HeatMode,
  type SignedVector,
} from "./exact-operator.js";
export interface ExactHeatResult extends SignedVector {
  tail: Words;
  order: number;
  work: number;
}
export function exactHeat(
  operator: ExactSparseOperator,
  source: SignedVector,
  time: Interval,
  threshold: Words,
  mode: HeatMode,
  work: ExactWork,
): ExactHeatResult {
  checkInterval(time);
  checkWords(threshold);
  if (compareWords(time[1], multiplyWords(word(64), SCALE)) > 0)
    throw new RangeError("Exact heat time must be in [0,64]");
  if (compareWords(threshold, ZERO) <= 0)
    throw new RangeError("Exact heat tolerance is below fixed-point precision");
  if (mode !== "forward" && mode !== "focus") throw new RangeError("Invalid exact heat mode");
  if (source.positive.length !== operator.n || source.negative.length !== operator.n)
    throw new RangeError("Exact source must match operator");
  let norm = ZERO;
  for (let i = 0; i < operator.n; i++) {
    checkInterval(source.positive[i]!);
    checkInterval(source.negative[i]!);
    const magnitude = addWords(source.positive[i]![1], source.negative[i]![1]);
    norm =
      mode === "forward"
        ? addWords(norm, magnitude)
        : compareWords(norm, magnitude) < 0
          ? magnitude
          : norm;
  }
  checkWords(norm);
  let vector = source,
    coefficient = expNegativeFixed(time);
  let positive = vector.positive.map((x) => mul(x, coefficient)),
    negative = vector.negative.map((x) => mul(x, coefficient));
  const finish = (order: number, tail: Words): ExactHeatResult => ({
    positive,
    negative,
    tail,
    order,
    work: work.used,
  });
  if (compareWords(norm, ZERO) === 0) return finish(0, ZERO);
  for (let order = 0; order < 512; order++) {
    const next = byInt(mul(coefficient, time), order + 1),
      ratio = byInt(time, order + 2),
      remainder = geometricTail(next[1], ratio[1]);
    if (remainder !== undefined) {
      const tail = mul([remainder, remainder], [norm, norm])[1];
      if (compareWords(tail, threshold) <= 0) return finish(order, tail);
    }
    vector = operator.apply(vector, mode, work);
    coefficient = next;
    positive = positive.map((x, i) => add(x, mul(vector.positive[i]!, coefficient)));
    negative = negative.map((x, i) => add(x, mul(vector.negative[i]!, coefficient)));
    for (const values of [positive, negative]) for (const value of values) checkInterval(value);
  }
  throw new RangeError("Heat certificate did not converge within its precision/iteration cap");
}
