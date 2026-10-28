// Canonical exact rational CSR, with private owned storage and u32 cursor steps.
import { add, divide, mul, ZERO, type Interval } from "./interval.js";
import { addWords, compareWords, type Words } from "./u32.js";
import { numericWorkStep, sparseEdgeStep } from "../verified/generated/limbs.js";
import type { ExactRow } from "./normalization.js";
export type HeatMode = "forward" | "focus";
export interface SignedVector {
  positive: Interval[];
  negative: Interval[];
}
export const MAX_EXACT_WORDS = 128;
export const emptyInterval = (): Interval => [ZERO, ZERO];
export function checkWords(words: Words): void {
  if (!(words instanceof Uint32Array) || words.length > MAX_EXACT_WORDS)
    throw new RangeError("Exact arithmetic limb capacity exceeded");
}
export function checkInterval(value: Interval): void {
  checkWords(value[0]);
  checkWords(value[1]);
  if (compareWords(value[0], value[1]) > 0) throw new RangeError("Invalid exact interval");
}
export class ExactWork {
  #used = 0;
  #limit: number;
  constructor(limit = 100000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
      throw new RangeError("Invalid certificate work cap");
    this.#limit = limit;
  }
  get limit(): number {
    return this.#limit;
  }
  get used(): number {
    return this.#used;
  }
  charge(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2000000)
      throw new RangeError("Invalid exact work charge");
    const step = numericWorkStep(this.#used, amount, this.limit);
    if (!step.admit) throw new RangeError("Heat certificate work cap exhausted");
    this.#used = step.used;
  }
}
export class ExactSparseOperator {
  #n: number;
  #edges: number;
  get n(): number {
    return this.#n;
  }
  get edges(): number {
    return this.#edges;
  }
  #rowPtr: Uint32Array;
  #col: Uint32Array;
  #numerators: Words[] = [];
  #denominators: Words[] = [];
  #probabilities: Interval[] = [];
  constructor(rows: readonly ExactRow[], work: ExactWork) {
    this.#n = rows.length;
    work.charge(this.n);
    this.#edges = rows.reduce((count, row) => count + row.entries.length, 0);
    work.charge(this.edges);
    this.#rowPtr = new Uint32Array(this.n + 1);
    this.#col = new Uint32Array(this.edges);
    let at = 0;
    for (let row = 0; row < this.n; row++) {
      const input = rows[row]!;
      checkWords(input.denominator);
      const denominator = input.denominator.slice();
      if (compareWords(denominator, ZERO) <= 0)
        throw new RangeError("Positive exact row denominator required");
      this.#denominators.push(denominator);
      let total = ZERO;
      for (const entry of input.entries) {
        if (!Number.isInteger(entry.to) || entry.to < 0 || entry.to >= this.n)
          throw new RangeError("Invalid exact operator edge");
        checkWords(entry.numerator);
        const numerator = entry.numerator.slice();
        total = addWords(total, numerator);
        checkWords(total);
        this.#col[at] = entry.to;
        this.#numerators.push(numerator);
        this.#probabilities.push(divide([numerator, numerator], [denominator, denominator]));
        at++;
      }
      if (compareWords(total, denominator) !== 0)
        throw new RangeError("Exact row mass must equal its denominator");
      this.#rowPtr[row + 1] = at;
    }
  }
  apply(vector: SignedVector, mode: HeatMode, work: ExactWork): SignedVector {
    if (mode !== "forward" && mode !== "focus") throw new RangeError("Invalid exact operator mode");
    if (vector.positive.length !== this.n || vector.negative.length !== this.n)
      throw new RangeError("Exact source must match operator");
    for (const values of [vector.positive, vector.negative])
      for (const value of values) checkInterval(value);
    work.charge(this.n + this.edges);
    const positive = Array.from({ length: this.n }, emptyInterval),
      negative = Array.from({ length: this.n }, emptyInterval);
    for (let row = 0; row < this.n; row++) {
      let at = this.#rowPtr[row]!;
      const end = this.#rowPtr[row + 1]!;
      while (at < end) {
        const step = sparseEdgeStep(
          row,
          this.n,
          at,
          end,
          this.edges,
          this.#col[at]!,
          mode === "forward",
        );
        if (!step.admit) throw new RangeError("Exact CSR traversal refused");
        const probability = this.#probabilities[at]!;
        positive[step.destination] = add(
          positive[step.destination]!,
          mul(probability, vector.positive[step.origin]!),
        );
        negative[step.destination] = add(
          negative[step.destination]!,
          mul(probability, vector.negative[step.origin]!),
        );
        checkInterval(positive[step.destination]!);
        checkInterval(negative[step.destination]!);
        at = step.next;
      }
    }
    return { positive, negative };
  }
}
