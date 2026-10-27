// Generated-source skip: minified bundles must never reach ast-grep pattern
// extraction (a single `$F($$$A)` run over duckdb's 800 KB worker took ~46 s
// and emitted 7.5 GB of match JSON).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cachePathFor, isGeneratedSource, loadFacts } from "../src/core/build.js";

const tmpRoots: string[] = [];
const tmpRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "pi-fovea-generated-"));
  tmpRoots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cachePathFor(dir), { force: true });
  }
});

describe("isGeneratedSource", () => {
  it("flags single-line minified bundles by content", () => {
    expect(
      isGeneratedSource("duckdb-browser-eh.worker.js", "var a=1;\n" + "x".repeat(5_000) + "\n"),
    ).toBe(true);
    expect(isGeneratedSource("app.js", "var a=" + "1,".repeat(3_000))).toBe(true);
  });

  it("flags conventional generated names", () => {
    expect(isGeneratedSource("vendor.min.js", "function tiny() {}")).toBe(true);
    expect(isGeneratedSource("chunk.bundle.ts", "export const x = 1;")).toBe(true);
  });

  it("passes ordinary source through", () => {
    expect(
      isGeneratedSource("worker.js", "export function onMessage(e) {\n  return e.data;\n}\n"),
    ).toBe(false);
    expect(
      isGeneratedSource("table.ts", "export const t = [\n" + "1, 2, 3,\n".repeat(200) + "];\n"),
    ).toBe(false);
    expect(isGeneratedSource("tiny.min.js", "")).toBe(true);
  });
});

describe("loadFacts generated skip", () => {
  it("records fact-free entries for minified files without extraction", async () => {
    const root = tmpRepo();
    writeFileSync(join(root, "ok.ts"), "export function hello() { return 'hi'; }\n");
    writeFileSync(join(root, "duckdb-worker.js"), "var a=1;" + "f();".repeat(2_000) + "\n");
    const { store, report, dirty } = await loadFacts(root, ["ok.ts", "duckdb-worker.js"]);
    expect(report.generated).toEqual(["duckdb-worker.js"]);
    expect(dirty).toEqual(["ok.ts"]);
    expect(store.generated.has("duckdb-worker.js")).toBe(true);
    expect(store.tainted.has("duckdb-worker.js")).toBe(false);
    const facts = store.facts.get("duckdb-worker.js");
    expect(facts).toBeDefined();
    expect(facts?.symbols).toHaveLength(0);
    expect(facts?.calls).toHaveLength(0);
  });

  it("re-extracts when a generated file turns into real source", async () => {
    const root = tmpRepo();
    writeFileSync(join(root, "mod.js"), "var a=1;" + "f();".repeat(2_000) + "\n");
    const first = await loadFacts(root, ["mod.js"]);
    expect(first.report.generated).toEqual(["mod.js"]);
    writeFileSync(join(root, "mod.js"), "export function real() {}\n");
    const second = await loadFacts(root, ["mod.js"]);
    expect(second.report.generated).toEqual([]);
    expect(second.store.generated.has("mod.js")).toBe(false);
    expect(second.store.facts.get("mod.js")?.symbols.length).toBeGreaterThan(0);
  });
});
