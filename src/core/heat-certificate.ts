// Float64 boundary adapters for the shared, authoritative u32 Poisson core.
import { focusField, forwardHeat, type Csr } from "./heat.js";
import { byInt, enclose, fixed, nextUp, signedBounds, ZERO, FIXED_BITS } from "./interval.js";
import { addWords, compareWords } from "./u32.js";
import { normalizeDyadicRow } from "./normalization.js";
import { ExactSparseOperator, ExactWork, emptyInterval, type HeatMode } from "./exact-operator.js";
import { exactHeat, type ExactHeatResult } from "./exact-heat.js";
export interface HeatCertificateOptions {
  mode?: HeatMode;
  absoluteTolerance?: number;
  /** Counts CSR preparation and normalized node/edge visits; at most 1e6. */
  maxWork?: number;
  /** If omitted, certifyHeat checks the existing Float64 solver. */
  candidate?: Float64Array;
}
export interface HeatCertificate {
  method: "u32-poisson-interval";
  target: "exact-edge-normalized-markov-heat";
  mode: HeatMode;
  time: number;
  value: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  maxAbsoluteError: number;
  withinTolerance: boolean;
  absoluteTolerance: number;
  poissonOrder: number;
  remainderBound: number;
  work: number;
  precisionBits: number;
  /** This is a conditional runtime certificate, not an exported analytic proof. */
  assumptions: readonly string[];
}
function evaluate(
  csr: Csr,
  source: Float64Array,
  time: number,
  options: HeatCertificateOptions,
  verify: boolean,
): HeatCertificate {
  const mode = options.mode ?? "forward",
    tolerance = options.absoluteTolerance ?? 1e-10,
    work = new ExactWork(options.maxWork ?? 100000);
  if (mode !== "forward" && mode !== "focus") throw new RangeError("Invalid certificate mode");
  if (!Number.isFinite(time) || time < 0 || time > 64)
    throw new RangeError("Certificate time must be in [0,64]");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new RangeError("Positive finite certificate tolerance required");
  const { n, rowPtr, col, w } = csr;
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > work.limit ||
    w.length > work.limit ||
    rowPtr.length !== n + 1 ||
    col.length !== w.length ||
    rowPtr[0] !== 0 ||
    rowPtr[n] !== w.length
  )
    throw new RangeError("Invalid or over-budget certificate CSR");
  if (source.length !== n || source.some((x) => !Number.isFinite(x)))
    throw new RangeError("Certificate source must be finite and match CSR");
  const threshold = byInt(fixed(tolerance), 8)[0];
  if (compareWords(threshold, ZERO) === 0)
    throw new RangeError("Certificate tolerance is below fixed-point precision");
  work.charge(n + w.length);
  for (let row = 0; row < n; row++) {
    if (rowPtr[row]! > rowPtr[row + 1]!)
      throw new RangeError("Certificate CSR row pointers must be monotone");
    for (let at = rowPtr[row]!; at < rowPtr[row + 1]!; at++)
      if (col[at]! >= n || !Number.isFinite(w[at]) || w[at]! < 0)
        throw new RangeError("Invalid certificate edge");
  }
  work.charge(n + w.length);
  const operator = new ExactSparseOperator(
    Array.from({ length: n }, (_, row) =>
      normalizeDyadicRow(row, col, w, rowPtr[row]!, rowPtr[row + 1]!),
    ),
    work,
  );
  const candidate = verify
    ? Float64Array.from(
        options.candidate ??
          (mode === "forward" ? forwardHeat(csr, source, time) : focusField(csr, source, time)),
      )
    : undefined;
  if (candidate && (candidate.length !== n || candidate.some((x) => !Number.isFinite(x))))
    throw new RangeError("Certificate candidate must be finite and match CSR");
  const vector = {
    positive: Array.from(source, (x) => (x > 0 ? fixed(x) : emptyInterval())),
    negative: Array.from(source, (x) => (x < 0 ? fixed(-x) : emptyInterval())),
  };
  const result = exactHeat(operator, vector, fixed(time), threshold, mode, work);
  return finish(result, mode, time, tolerance, candidate);
}
function finish(
  result: ExactHeatResult,
  mode: HeatMode,
  time: number,
  tolerance: number,
  candidate?: Float64Array,
): HeatCertificate {
  const n = result.positive.length,
    lower = new Float64Array(n),
    upper = new Float64Array(n),
    value = candidate ?? new Float64Array(n);
  let maxAbsoluteError = 0;
  for (let i = 0; i < n; i++) {
    const p = result.positive[i]!,
      m = result.negative[i]!,
      bounds = signedBounds(
        [p[0], addWords(p[1], result.tail)],
        [m[0], addWords(m[1], result.tail)],
      );
    if (!Number.isFinite(bounds.lower) || !Number.isFinite(bounds.upper))
      throw new RangeError("Certificate bound overflow");
    lower[i] = bounds.lower;
    upper[i] = bounds.upper;
    if (!candidate) value[i] = bounds.lower / 2 + bounds.upper / 2;
    maxAbsoluteError = Math.max(
      maxAbsoluteError,
      nextUp(Math.max(Math.abs(value[i]! - bounds.lower), Math.abs(value[i]! - bounds.upper))),
    );
  }
  return {
    method: "u32-poisson-interval",
    target: "exact-edge-normalized-markov-heat",
    mode,
    time,
    value,
    lower,
    upper,
    maxAbsoluteError,
    withinTolerance: maxAbsoluteError <= tolerance,
    absoluteTolerance: tolerance,
    poissonOrder: result.order,
    remainderBound:
      compareWords(result.tail, ZERO) === 0 ? 0 : enclose([result.tail, result.tail]).upper,
    work: result.work,
    precisionBits: FIXED_BITS,
    assumptions: [
      "Sound u32 limb/interval implementation and JS engine",
      "Poisson-series identity and stochastic-operator norm bound",
    ],
  };
}
/** Verify a fast or caller-supplied candidate against the exact core. */
export function certifyHeat(
  csr: Csr,
  source: Float64Array,
  time: number,
  options: HeatCertificateOptions = {},
): HeatCertificate {
  return evaluate(csr, source, time, options, true);
}
/** Solve directly from the exact core; never runs the Float64 Chebyshev solver. */
export function solveHeat(
  csr: Csr,
  source: Float64Array,
  time: number,
  options: Omit<HeatCertificateOptions, "candidate"> = {},
): HeatCertificate {
  return evaluate(csr, source, time, options, false);
}
