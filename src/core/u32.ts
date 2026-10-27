// Unsigned little-endian base-2^32 integers. Arrays are immutable by convention;
// every arithmetic result owns its storage. No BigInt and no silent overflow.
import { roundingIncrement } from "../verified/generated/limbs.js";
import {
  addWordArrays,
  subtractWordArrays,
  multiplyAddRow,
  divideArraySmall,
  compareWordArrays,
} from "../verified/generated/streams.js";
export type Words = Uint32Array;
const U32_MAX = 0xffffffff;
const BASE = 0x100000000;
export const checkedU32 = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX)
    throw new RangeError(`Expected u32, got ${value}`);
  return value;
};
const length = (a: Words): number => {
  let n = a.length;
  while (n && a[n - 1] === 0) n--;
  return n;
};
const trim = (a: Words): Words => a.slice(0, length(a));
export const word = (value: number): Words =>
  value === 0 ? new Uint32Array() : new Uint32Array([checkedU32(value)]);
export const compareWords = compareWordArrays;
export const addWords = addWordArrays;
export const subtractWords = subtractWordArrays;
const half = (a: Words, i: number): number => (i % 2 ? a[i >>> 1]! >>> 16 : a[i >>> 1]! & 65535);
export const multiplyWords = (a: Words, b: Words): Words => {
  if (!length(a) || !length(b)) return word(0);
  const n = 2 * a.length,
    m = 2 * b.length,
    out = new Uint32Array(n + m),
    source = new Uint32Array(m);
  for (let j = 0; j < m; j++) source[j] = half(b, j);
  // Each complete multiply-add row executes its proved stream. The outer
  // schoolbook traversal and half-word packing remain explicit host adapters.
  for (let i = 0; i < n; i++)
    out.set(multiplyAddRow(half(a, i), source, out.subarray(i, i + m)), i);
  const packed = new Uint32Array(a.length + b.length);
  for (let i = 0; i < packed.length; i++) packed[i] = out[2 * i]! + out[2 * i + 1]! * 65536;
  return trim(packed);
};
const shiftCount = (bits: number): void => {
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 65536)
    throw new RangeError("Invalid limb shift");
};
export const shiftLeft = (a: Words, bits: number): Words => {
  shiftCount(bits);
  if (!length(a)) return word(0);
  const whole = Math.floor(bits / 32),
    part = bits % 32,
    out = new Uint32Array(a.length + whole + 1);
  let carry = 0;
  for (let i = 0; i < a.length; i++) {
    out[i + whole] = ((a[i]! << part) | carry) >>> 0;
    carry = part ? a[i]! >>> (32 - part) : 0;
  }
  out[a.length + whole] = carry;
  return trim(out);
};
export const shiftRight = (a: Words, bits: number): Words => {
  shiftCount(bits);
  const whole = Math.floor(bits / 32),
    part = bits % 32;
  if (whole >= a.length) return word(0);
  const out = new Uint32Array(a.length - whole);
  for (let i = 0; i < out.length; i++)
    out[i] = part
      ? ((a[i + whole]! >>> part) | ((a[i + whole + 1] ?? 0) << (32 - part))) >>> 0
      : a[i + whole]!;
  return trim(out);
};
export const discardedBits = (a: Words, bits: number): boolean => {
  shiftCount(bits);
  const whole = Math.floor(bits / 32),
    part = bits % 32;
  for (let i = 0; i < Math.min(whole, a.length); i++) if (a[i]) return true;
  return part > 0 && ((a[whole] ?? 0) & (2 ** part - 1)) !== 0;
};
const bitLength = (a: Words): number => {
  const n = length(a);
  return n ? 32 * (n - 1) + 32 - Math.clz32(a[n - 1]!) : 0;
};
export const divideWords = (a: Words, b: Words): { quotient: Words; remainder: Words } => {
  if (!length(b)) throw new RangeError("Division by zero");
  if (compareWords(a, b) < 0) return { quotient: word(0), remainder: a.slice() };
  let offset = bitLength(a) - bitLength(b),
    divisor = shiftLeft(b, offset),
    remainder: Words = a.slice();
  const quotient = new Uint32Array(Math.floor(offset / 32) + 1);
  for (; offset >= 0; offset--) {
    if (compareWords(remainder, divisor) >= 0) {
      remainder = subtractWords(remainder, divisor);
      quotient[offset >>> 5] = ((quotient[offset >>> 5] ?? 0) | (1 << (offset % 32))) >>> 0;
    }
    divisor = shiftRight(divisor, 1);
  }
  return { quotient: trim(quotient), remainder };
};
export const divideSmall = divideArraySmall;
export const roundedShiftRight = (
  a: Words,
  bits: number,
  mode: "floor" | "ceil" | "nearest",
): Words => {
  const out = shiftRight(a, bits),
    guard = bits > 0 && ((shiftRight(a, bits - 1)[0] ?? 0) & 1) !== 0;
  const sticky = bits > 0 && discardedBits(a, bits - 1),
    odd = ((out[0] ?? 0) & 1) !== 0;
  const increment = roundingIncrement({ floor: 0, ceil: 1, nearest: 2 }[mode], guard, sticky, odd);
  return increment ? addWords(out, word(1)) : out;
};
/** Correct round-to-nearest-even conversion, not repeated rounded limb summation. */
export const wordsToNumber = (a: Words): number => {
  const bits = bitLength(a),
    shift = Math.max(0, bits - 53),
    top = roundedShiftRight(a, shift, "nearest");
  let value = 0;
  for (let i = top.length - 1; i >= 0; i--) value = value * BASE + top[i]!;
  return value * 2 ** shift;
};
