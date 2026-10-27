import { describe, expect, it } from "vitest";
import { replaceSource } from "./helpers/source-mutation.js";

describe("proof source mutations", () => {
  it("matches formatted code without weakening its target", () => {
    const source = 'const result = rule.law(\n  "bounded",\n  state => state.count,\n);\n';
    expect(replaceSource(source, "rule.law('bounded',state=>state.count)", "broken()")).toBe(
      "const result = broken();\n",
    );
  });
  it("matches after interpolated templates and inside expression fragments", () => {
    const source = "const label = `${name}_value`; const result = { carry: when(take, c, carry) };";
    expect(replaceSource(source, "carry:when(take,c,carry)", "carry:0")).toContain("{ carry:0 }");
    expect(
      replaceSource(
        'const v = term("left").plus(term("carry"));',
        ".plus(term('carry'))",
        ".plus(0)",
      ),
    ).toContain(".plus(0)");
  });
  it("refuses missing or ambiguous targets", () => {
    expect(() => replaceSource("first()", "second()", "broken()")).toThrow("found 0");
    expect(() => replaceSource("first();first()", "first()", "broken()")).toThrow("found 2");
  });
});
