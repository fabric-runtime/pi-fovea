// The join layer: normalization across router conventions, specificity
// weighting, and pair edges.

import { describe, expect, it } from "vitest";
import { buildJoinIndex, classifyLiteral, normalizeLiteral } from "../src/core/join.js";
import type { LiteralSite } from "../src/core/types.js";

describe("literal normalization", () => {
  it("unifies router placeholder conventions", () => {
    const a = normalizeLiteral("/api/users/:id", "path");
    const b = normalizeLiteral("/api/users/{id}", "path");
    const c = normalizeLiteral("/api/users/${id}", "path");
    expect(a).toBe("/api/users/{*}");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("strips URL origins and trailing slashes", () => {
    expect(normalizeLiteral("https://api.example.com/api/users/{id}/", "path")).toBe(
      "/api/users/{*}",
    );
  });

  it("classifies env keys, paths, and rejects noise", () => {
    expect(classifyLiteral("DATABASE_URL")).toBe("env");
    expect(classifyLiteral("/api/users/{id}")).toBe("path");
    expect(classifyLiteral("x")).toBeUndefined();
    expect(classifyLiteral("hello there world")).toBeUndefined();
    expect(classifyLiteral("com.acme.billing.UserService")).toBe("word");
  });
});

describe("join index", () => {
  const sites: LiteralSite[] = [
    { file: "server/main.go", line: 11, text: "/api/users/:id" },
    { file: "web/api.ts", line: 9, text: "/api/users/${id}" },
    { file: "openapi.yaml", line: 3, text: "/api/users/{id}" },
    { file: "worker/jobs.py", line: 3, text: "DATABASE_URL" },
    { file: "server/config.go", line: 4, text: "DATABASE_URL" },
    { file: "a.ts", line: 1, text: "/health" },
    { file: "b.ts", line: 1, text: "/health" },
    { file: "c.ts", line: 1, text: "/health" },
    { file: "d.ts", line: 1, text: "/health" },
  ];
  // node numbering: file order above, node index = position in `files`.
  const files = [
    "server/main.go",
    "web/api.ts",
    "openapi.yaml",
    "worker/jobs.py",
    "server/config.go",
    "a.ts",
    "b.ts",
    "c.ts",
    "d.ts",
  ];
  const resolver = (file: string) => files.indexOf(file);

  it("joins the same route across languages and env across languages", () => {
    const idx = buildJoinIndex(sites, resolver);
    const pairs = new Set(idx.edges.map((e) => `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}`));
    // /api/users/{*}: main.go(0) x api.ts(1) x openapi.yaml(2)
    expect(pairs.has("0|1")).toBe(true);
    expect(pairs.has("0|2")).toBe(true);
    expect(pairs.has("1|2")).toBe(true);
    // DATABASE_URL: jobs.py(3) x config.go(4)
    expect(pairs.has("3|4")).toBe(true);
  });

  it("weights specific literals above common ones (IDF gradation)", () => {
    const idx = buildJoinIndex(sites, resolver);
    const routeW = idx.edges.find((e) => [e.a, e.b].includes(0) && [e.a, e.b].includes(1))!.w;
    const healthW = idx.edges.find((e) => [e.a, e.b].includes(5) && [e.a, e.b].includes(6))!.w;
    expect(routeW).toBeGreaterThan(healthW);
    expect(idx.byKey.get("/api/users/{*}")!.spec).toBeGreaterThan(idx.byKey.get("/health")!.spec);
  });

  it("drops singletons (no spurious self-joins)", () => {
    const idx = buildJoinIndex([{ file: "x.ts", line: 1, text: "/only/once" }], (f) =>
      f === "x.ts" ? 0 : undefined,
    );
    expect(idx.edges.length).toBe(0);
  });
});
