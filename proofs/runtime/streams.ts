// ABI adapter only; decisions and arithmetic come from the checked machines.
import type { RuntimeMachine } from "../runtime.ts";
type PairInput = { a: number; b: number };
type ForwardState = "done" | "pos" | "word" | "size" | "carry" | "error";
declare const compare32: RuntimeMachine<{ count: number }, PairInput, "done" | "pos" | "relation">;
declare const add32: RuntimeMachine<{ count: number }, PairInput, ForwardState>;
declare const subtract32: RuntimeMachine<{ count: number }, PairInput, ForwardState>;
declare const multiply16: RuntimeMachine<
  { count: number; factor: number },
  PairInput & { low: number; high: number },
  ForwardState
>;
declare const divide16: RuntimeMachine<
  { count: number; divisor: number },
  { digit: number; quotient: number; remainder: number },
  "done" | "pos" | "word" | "carry" | "error"
>;
const wordsLength = (a: Uint32Array): number => {
  if (!(a instanceof Uint32Array)) throw new TypeError("Expected Uint32Array");
  return a.length;
};
const streamCount = (n: number): number => {
  if (!Number.isInteger(n) || n < 0 || n > 4294967294)
    throw new RangeError("Invalid stream length");
  return n;
};
export function compareWordArrays(a: Uint32Array, b: Uint32Array): number {
  const p = { count: streamCount(Math.max(wordsLength(a), wordsLength(b))) };
  let st = compare32.init(p);
  while (!st.scalars.done) {
    const i = p.count - 1 - st.scalars.pos;
    st = compare32.step(p, st, { a: a[i] ?? 0, b: b[i] ?? 0 });
  }
  return st.scalars.relation === 1 ? -1 : st.scalars.relation === 2 ? 1 : 0;
}
export function addWordArrays(a: Uint32Array, b: Uint32Array): Uint32Array {
  const p = { count: streamCount(Math.max(wordsLength(a), wordsLength(b))) },
    out = new Uint32Array(p.count + 1);
  let st = add32.init(p);
  while (!st.scalars.done) {
    const i = st.scalars.pos;
    st = add32.step(p, st, { a: a[i] ?? 0, b: b[i] ?? 0 });
    out[i] = st.scalars.word;
  }
  return out.slice(0, st.scalars.size);
}
export function subtractWordArrays(a: Uint32Array, b: Uint32Array): Uint32Array {
  const p = { count: streamCount(Math.max(wordsLength(a), wordsLength(b))) },
    out = new Uint32Array(p.count + 1);
  let st = subtract32.init(p);
  while (!st.scalars.done) {
    const i = st.scalars.pos;
    st = subtract32.step(p, st, { a: a[i] ?? 0, b: b[i] ?? 0 });
    out[i] = st.scalars.word;
  }
  if (st.scalars.carry) throw new RangeError("Unsigned subtraction underflow");
  return out.slice(0, st.scalars.size);
}
export function multiplyAddRow(
  factor: number,
  source: Uint32Array,
  accumulator: Uint32Array,
): Uint32Array {
  if (!Number.isInteger(factor) || factor < 0 || factor > 65535)
    throw new RangeError("Expected u16 factor");
  if (wordsLength(source) !== wordsLength(accumulator))
    throw new RangeError("Mismatched multiplication row");
  const p = { count: streamCount(source.length), factor },
    out = new Uint32Array(p.count + 1);
  let st = multiply16.init(p);
  while (!st.scalars.done) {
    const i = st.scalars.pos,
      a = source[i] ?? 0,
      b = accumulator[i] ?? 0,
      total = a * factor + b + st.scalars.carry;
    st = multiply16.step(p, st, { a, b, low: total & 65535, high: total >>> 16 });
    if (st.scalars.error) throw new Error("Invalid multiplication digit");
    out[i] = st.scalars.word;
  }
  return out;
}
export function divideArraySmall(
  a: Uint32Array,
  divisor: number,
): { quotient: Uint32Array; remainder: number } {
  if (!Number.isInteger(divisor) || divisor <= 0 || divisor > 4294967295)
    throw new RangeError("Expected positive u32 divisor");
  const p = { count: streamCount(2 * wordsLength(a)), divisor },
    out = new Uint32Array(p.count);
  let st = divide16.init(p);
  while (!st.scalars.done) {
    const i = p.count - 1 - st.scalars.pos,
      digit = i % 2 ? a[i >>> 1]! >>> 16 : a[i >>> 1]! & 65535;
    const numerator = st.scalars.carry * 65536 + digit,
      quotient = Math.floor(numerator / divisor),
      remainder = numerator - quotient * divisor;
    st = divide16.step(p, st, { digit, quotient, remainder });
    if (st.scalars.error) throw new Error("Invalid division digit");
    out[i] = st.scalars.word;
  }
  const packed = new Uint32Array(a.length);
  for (let i = 0; i < packed.length; i++) packed[i] = out[2 * i]! + out[2 * i + 1]! * 65536;
  let n = packed.length;
  while (n && packed[n - 1] === 0) n--;
  return { quotient: packed.slice(0, n), remainder: st.scalars.carry };
}
