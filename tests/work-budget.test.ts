import { describe, expect, it } from "vitest";
import { numericWorkStep } from "../src/verified/generated/limbs.js";

describe("numeric work adapter", () => {
  it.each([
    [-1, 0, 10],
    [0.5, 0, 10],
    [1000001, 0, 1000000],
    [0, -1, 10],
    [0, 0.5, 10],
    [0, 2000001, 10],
    [0, 0, -1],
    [0, 0, 0.5],
    [0, 0, 1000001],
    [11, 0, 10],
    [NaN, 0, 10],
    [0, Infinity, 10],
  ])("rejects invalid inputs (%s, %s, %s)", (used, amount, limit) => {
    expect(() => numericWorkStep(used, amount, limit)).toThrow();
  });
  it("admits exact capacity and refuses excess without spending", () => {
    expect(numericWorkStep(4, 6, 10)).toEqual({ used: 10, admit: true });
    expect(numericWorkStep(4, 7, 10)).toEqual({ used: 4, admit: false });
  });
});
