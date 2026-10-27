// Exact rational rows from finite nonnegative IEEE-754 input weights.
// The dyadic codec and limb operations are the remaining implementation bridge;
// the raw-row algebra is checked in proofs/normalization.ts.
import { dyadic } from "./interval.js";
import { addWords, shiftLeft, word, type Words } from "./u32.js";
export interface ExactRow {
  readonly identity: boolean;
  readonly denominator: Words;
  readonly entries: ReadonlyArray<{ readonly to: number; readonly numerator: Words }>;
}
/** No floating-point weight sum and no pre-normalization fixed-point rounding. */
export function normalizeDyadicRow(
  self: number,
  col: Uint32Array,
  w: Float64Array,
  start = 0,
  end = w.length,
): ExactRow {
  if (
    !Number.isSafeInteger(self) ||
    self < 0 ||
    self > 0xffffffff ||
    col.length !== w.length ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    end > w.length
  )
    throw new RangeError("Invalid normalization row");
  const terms: Array<{ to: number; n: Words; e: number }> = [];
  let exponent = Infinity;
  for (let p = start; p < end; p++) {
    const weight = w[p]!;
    if (!Number.isFinite(weight) || weight < 0)
      throw new RangeError("Invalid normalization weight");
    if (weight === 0) continue;
    const { n, e } = dyadic(weight);
    terms.push({ to: col[p]!, n, e });
    exponent = Math.min(exponent, e);
  }
  if (!terms.length)
    return { identity: true, denominator: word(1), entries: [{ to: self, numerator: word(1) }] };
  let denominator = word(0);
  const entries = terms.map(({ to, n, e }) => {
    const numerator = shiftLeft(n, e - exponent);
    denominator = addWords(denominator, numerator);
    return { to, numerator };
  });
  return { identity: false, denominator, entries };
}
