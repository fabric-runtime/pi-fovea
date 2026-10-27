// A bounded, opt-in verifier for actual Float64 diffusion results. Its reference
// uses positive Poisson terms, not Chebyshev vectors or the candidate's degrees.
import { focusField, forwardHeat, type Csr } from "./heat.js";
import { expNegativeInterval } from "./numerics.js";
import {
  add,
  byInt,
  divide,
  enclose,
  fixed,
  geometricTail,
  mul,
  nextUp,
  signedBounds,
  ZERO,
  type Interval,
} from "./interval.js";
import { addWords, compareWords, type Words } from "./u32.js";
import { numericWorkStep } from "../verified/generated/limbs.js";
import { normalizeDyadicRow } from "./normalization.js";

export interface HeatCertificateOptions {
  mode?: "forward" | "focus";
  absoluteTolerance?: number;
  /** Counts normalized edges/nodes and subsequent operator visits; at most 1e6. */
  maxWork?: number;
  /** If omitted, verify the existing Float64 solver's result. */
  candidate?: Float64Array;
}
export interface HeatCertificate {
  method: "u32-poisson-interval";
  target: "exact-edge-normalized-markov-heat";
  mode: "forward" | "focus";
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
  /** This is a conditional runtime certificate, not an exported analytic proof. */
  assumptions: readonly string[];
}
type Arc = { to: number; probability: Interval };
const empty = (): Interval => [ZERO, ZERO];

export function certifyHeat(
  csr: Csr,
  source: Float64Array,
  time: number,
  options: HeatCertificateOptions = {},
): HeatCertificate {
  const mode = options.mode ?? "forward",
    tolerance = options.absoluteTolerance ?? 1e-10,
    maxWork = options.maxWork ?? 100000;
  if (mode !== "forward" && mode !== "focus") throw new RangeError("Invalid certificate mode");
  if (!Number.isFinite(time) || time < 0 || time > 64)
    throw new RangeError("Certificate time must be in [0,64]");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new RangeError("Positive finite certificate tolerance required");
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || maxWork > 1000000)
    throw new RangeError("Invalid certificate work cap");
  const { n, rowPtr, col, w } = csr;
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > maxWork ||
    w.length > maxWork ||
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
  let work = 0;
  const charge = (count: number) => {
    const step = numericWorkStep(work, count, maxWork);
    if (!step.admit) throw new RangeError("Heat certificate work cap exhausted");
    work = step.used;
  };
  charge(n + w.length);
  for (let i = 0; i < n; i++) {
    if (rowPtr[i]! > rowPtr[i + 1]!)
      throw new RangeError("Certificate CSR row pointers must be monotone");
    for (let p = rowPtr[i]!; p < rowPtr[i + 1]!; p++)
      if (col[p]! >= n || !Number.isFinite(w[p]) || w[p]! < 0)
        throw new RangeError("Invalid certificate edge");
  }
  // Normalize exact integer dyadic weights first; only division is rounded
  // outward. Stored csr.deg is not trusted. An empty arc list below is the
  // optimized execution of the normalizer's explicit identity self-loop.
  const rows: Arc[][] = [];
  charge(n + w.length);
  for (let i = 0; i < n; i++) {
    const exact = normalizeDyadicRow(i, col, w, rowPtr[i]!, rowPtr[i + 1]!);
    rows.push(
      exact.identity
        ? []
        : exact.entries.map(({ to, numerator }) => ({
            to,
            probability: divide([numerator, numerator], [exact.denominator, exact.denominator]),
          })),
    );
  }
  const candidate = Float64Array.from(
    options.candidate ??
      (mode === "forward" ? forwardHeat(csr, source, time) : focusField(csr, source, time)),
  );
  if (candidate.length !== n || candidate.some((x) => !Number.isFinite(x)))
    throw new RangeError("Certificate candidate must be finite and match CSR");
  let positive = Array.from(source, (x) => (x > 0 ? fixed(x) : empty())),
    negative = Array.from(source, (x) => (x < 0 ? fixed(-x) : empty()));
  let norm = ZERO;
  for (let i = 0; i < n; i++) {
    const magnitude = addWords(positive[i]![1], negative[i]![1]);
    norm =
      mode === "forward"
        ? addWords(norm, magnitude)
        : compareWords(norm, magnitude) < 0
          ? magnitude
          : norm;
  }
  let coefficient = expNegativeInterval(time),
    sumPositive = positive.map((x) => mul(x, coefficient)),
    sumNegative = negative.map((x) => mul(x, coefficient));
  const finish = (order: number, tail: Words): HeatCertificate => {
    const lower = new Float64Array(n),
      upper = new Float64Array(n);
    let maxAbsoluteError = 0;
    for (let i = 0; i < n; i++) {
      const p = sumPositive[i]!,
        m = sumNegative[i]!;
      const bounds = signedBounds([p[0], addWords(p[1], tail)], [m[0], addWords(m[1], tail)]);
      if (!Number.isFinite(bounds.lower) || !Number.isFinite(bounds.upper))
        throw new RangeError("Certificate bound overflow");
      lower[i] = bounds.lower;
      upper[i] = bounds.upper;
      maxAbsoluteError = Math.max(
        maxAbsoluteError,
        nextUp(Math.max(Math.abs(candidate[i]! - lower[i]!), Math.abs(candidate[i]! - upper[i]!))),
      );
    }
    return {
      method: "u32-poisson-interval",
      target: "exact-edge-normalized-markov-heat",
      mode,
      time,
      value: candidate,
      lower,
      upper,
      maxAbsoluteError,
      withinTolerance: maxAbsoluteError <= tolerance,
      absoluteTolerance: tolerance,
      poissonOrder: order,
      remainderBound: compareWords(tail, ZERO) === 0 ? 0 : enclose([tail, tail]).upper,
      work,
      assumptions: [
        "Sound u32 limb/interval implementation and JS engine",
        "Poisson-series identity and stochastic-operator norm bound",
      ],
    };
  };
  if (compareWords(norm, ZERO) === 0) return finish(0, ZERO);
  const advance = (pos: Interval[], neg: Interval[]): [Interval[], Interval[]] => {
    charge(n + w.length);
    const outPos = Array.from({ length: n }, empty),
      outNeg = Array.from({ length: n }, empty);
    for (let i = 0; i < n; i++) {
      if (!rows[i]!.length) {
        outPos[i] = add(outPos[i]!, pos[i]!);
        outNeg[i] = add(outNeg[i]!, neg[i]!);
        continue;
      }
      for (const { to, probability } of rows[i]!) {
        const dest = mode === "forward" ? to : i,
          origin = mode === "forward" ? i : to;
        outPos[dest] = add(outPos[dest]!, mul(probability, pos[origin]!));
        outNeg[dest] = add(outNeg[dest]!, mul(probability, neg[origin]!));
      }
    }
    return [outPos, outNeg];
  };
  const t = fixed(time);
  for (let k = 0; k < 512; k++) {
    const next = byInt(mul(coefficient, t), k + 1),
      ratio = byInt(t, k + 2),
      poissonTail = geometricTail(next[1], ratio[1]);
    if (poissonTail !== undefined) {
      const tail = mul([poissonTail, poissonTail], [norm, norm])[1];
      if (compareWords(tail, threshold) <= 0) return finish(k, tail);
    }
    [positive, negative] = advance(positive, negative);
    coefficient = next;
    sumPositive = sumPositive.map((x, i) => add(x, mul(positive[i]!, coefficient)));
    sumNegative = sumNegative.map((x, i) => add(x, mul(negative[i]!, coefficient)));
  }
  throw new RangeError("Heat certificate did not converge within its precision/iteration cap");
}
