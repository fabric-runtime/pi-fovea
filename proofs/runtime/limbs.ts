// ABI adapter only; decisions and arithmetic come from the checked machines.
import type { DecisionMachine } from "../runtime.ts";
declare const addWord: DecisionMachine<"out.word" | "out.carry">;
declare const subtractWord: DecisionMachine<"out.word" | "out.borrow">;
declare const multiplyCell: DecisionMachine<"out.total">;
declare const divisionCell: DecisionMachine<"out.valid">;
declare const work: DecisionMachine<"out.used" | "out.admit">;
declare const rounding: DecisionMachine<"out.increment">;
const run = <Output extends string>(m: DecisionMachine<Output>, input: Record<string, number>) =>
  m.step({}, m.init({}), input).scalars;
export function addCell(a: number, b: number, carry: number): { word: number; carry: number } {
  const s = run(addWord, { a, b, carry });
  return { word: s["out.word"], carry: s["out.carry"] };
}
export function subtractCell(
  a: number,
  b: number,
  borrow: number,
): { word: number; borrow: number } {
  const s = run(subtractWord, { a, b, borrow });
  return { word: s["out.word"], borrow: s["out.borrow"] };
}
export function productCell(a: number, b: number, cell: number, carry: number): number {
  return run(multiplyCell, { a, b, cell, carry })["out.total"];
}
export function validDivisionCell(
  previous: number,
  digit: number,
  divisor: number,
  quotient: number,
  remainder: number,
): boolean {
  return !!run(divisionCell, { previous, digit, divisor, quotient, remainder })["out.valid"];
}
export function numericWorkStep(
  used: number,
  amount: number,
  limit: number,
): { used: number; admit: boolean } {
  const s = run(work, { used, amount, limit });
  return { used: s["out.used"], admit: !!s["out.admit"] };
}
export function roundingIncrement(
  mode: number,
  guard: boolean,
  sticky: boolean,
  odd: boolean,
): number {
  return run(rounding, { mode, guard: +guard, sticky: +sticky, odd: +odd })["out.increment"];
}
