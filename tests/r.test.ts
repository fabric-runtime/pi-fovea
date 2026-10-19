import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAstGrep, langOf, scanRules } from "../src/core/astgrep.js";
import { extractR } from "../src/core/r.js";
import { cachePathFor, clearPersistTimer, filterSupported, loadFacts, refreshFacts, type FileFacts } from "../src/core/build.js";
import { coreFactsFromScan, coreScanRules, extractCalls, extractImports, extractLiterals, extractSymbols, isTestFile, supportsImportExtraction } from "../src/core/extract.js";
import { assembleGraphWithIndex } from "../src/core/graph.js";
import { ensureState, evictState, focus } from "../src/core/ops.js";
import { resetSessions } from "../src/core/session.js";
import { makeFileSource } from "../src/core/source.js";

const roots: string[] = [];
const fixture = (sources: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "pi-fovea-r-"));
  roots.push(root);
  for (const [file, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};
afterEach(() => {
  vi.unstubAllEnvs();
  resetSessions();
  for (const root of roots.splice(0)) {
    evictState(root);
    clearPersistTimer(root);
    rmSync(root, { recursive: true, force: true });
    rmSync(cachePathFor(root), { force: true });
  }
});

const FIXTURE = new URL("./fixtures/r", import.meta.url).pathname;
const program = readFileSync(join(FIXTURE, "stats.R"), "utf8");

const graphFor = async (sources: Record<string, string>) => {
  const facts = new Map<string, FileFacts>();
  for (const [file, text] of Object.entries(sources)) {
    facts.set(file, { sha1: "fixture", anchors: [], ...extractR(file, text) });
  }
  return (await assembleGraphWithIndex("/unused", Object.keys(sources), facts)).graph;
};

describe("R source reader", () => {
  it("registers .R as source with import coverage, testthat conventions and no ast-grep rules", () => {
    expect(langOf("stats.R")).toBe("R");
    expect(langOf("MAIN.R")).toBe("R");
    expect(filterSupported(["stats.R", "helpers.r", "unknown.xyz"])).toEqual(["stats.R", "helpers.r"]);
    expect(supportsImportExtraction("R")).toBe(true);
    expect(isTestFile("tests/testthat/test-stats.R")).toBe(true);
    expect(isTestFile("tests/testthat.R")).toBe(true);
    expect(isTestFile("tests/testthat/helper-data.R")).toBe(true);
    expect(isTestFile("R/stats.R")).toBe(false);
    expect(coreScanRules(["stats.R"])).toEqual([]);
    expect(coreScanRules(["stats.R", "api.ts"]).every((rule) => rule.language === "TypeScript")).toBe(true);
  });

  it("extracts functions, S4 generics, R6 methods and exact lines", () => {
    const facts = extractR("stats.R", program);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["trim_price", "function", 8], ["fit_model", "function", 13],
      ["summary_stats", "function", 18], ["Account", "class", 22],
      ["deposit", "function", 23], ["Wallet", "class", 31],
      ["Wallet.initialize", "method", 34], ["Wallet.deposit", "method", 37],
      ["run_report", "function", 44],
    ]);
    expect(facts.symbols.every((symbol) => symbol.lang === "R")).toBe(true);
    expect(facts.imports).toEqual([
      { file: "stats.R", line: 3, spec: "dplyr" },
      { file: "stats.R", line: 4, spec: "stringr" },
      { file: "stats.R", line: 5, spec: "tibble" },
      { file: "stats.R", line: 6, spec: "./helpers.R" },
    ]);
    expect(facts.calls.map(({ callee, line }) => [callee, line])).toEqual([
      ["glm", 14], ["setClass", 22], ["setGeneric", 23], ["standardGeneric", 23],
      ["setMethod", 24], ["signature", 25], ["R6Class", 31], ["invisible", 39],
      ["read.csv", 45], ["trim_price", 46], ["dplyr::mutate", 47], ["str_detect", 49],
    ]);
    expect(facts.literals.map((site) => [site.text, site.line])).toEqual([
      ["stringr", 4], ["tibble", 5], ["./helpers.R", 6],
      ["NA", 8], ["USD", 10], ["Account", 22], ["character", 22], ["numeric", 22],
      ["deposit", 23], ["deposit", 24], ["Account", 25], ["Wallet", 31],
      ["/api/report", 44], ["EUR", 47], ["total: ", 48], ["^\\d+", 49],
    ]);
  });

  it("masks comments, escaped quotes and base mega-hub noise", () => {
    const text = [
      "#!/usr/bin/env Rscript",
      "x <- \"quoted # not a comment\" # real() comment",
      "eq == function(x) x",
      "c(1, 2)",
      "sapply(x, function(i) i)",
      "y <- 'single \"quoted\"'",
    ].join("\n");
    const facts = extractR("edge.R", text);
    expect(facts.symbols).toEqual([]);
    expect(facts.calls).toEqual([]);
    expect(facts.literals.map((site) => site.text)).toEqual([
      "quoted # not a comment", 'single "quoted"',
    ]);
  });

  it("skips argument-default and local nested function definitions", () => {
    const text = [
      "optimize(",
      "  par = c(0, 1),",
      "  fn = function(x) x ^ 2",
      ")",
      "outer <- function(df) {",
      "  local_helper <- function(y) y",
      "  local_helper(df)",
      "}",
    ].join("\n");
    const facts = extractR("nested.R", text);
    expect(facts.symbols.map((symbol) => symbol.name)).toEqual(["outer"]);
    expect(facts.calls.map((call) => call.callee)).toEqual(["optimize", "local_helper"]);
  });

  it("keeps standalone and consolidated facts identical without a grammar", async () => {
    const root = fixture({ "stats.R": program });
    const source = makeFileSource(root);
    const files = ["stats.R"];
    const native = extractR(files[0]!, program);
    expect(await extractSymbols(files, root, source)).toEqual(native.symbols);
    expect(await extractImports(files, root, source)).toEqual(native.imports);
    expect(await extractCalls(files, root, source)).toEqual(native.calls);
    expect(await extractLiterals(files, root, source)).toEqual(native.literals);
    expect(await coreFactsFromScan(files, root, source, [])).toEqual({
      imports: native.imports, calls: native.calls, literals: native.literals,
    });
  });

  it("resolves source() includes while installed packages stay unresolved", async () => {
    const graph = await graphFor({
      "R/main.R": [
        "source('./helpers.R')",
        "library(dplyr)",
        "main <- function() {",
        "  prepare(dplyr::coalesce(1, 0))",
        "}",
      ].join("\n"),
      "R/helpers.R": "prepare <- function(x) x\n",
    });
    const invokes = graph.edges.filter((edge) => edge.kind === "invokes");
    expect(invokes.map((edge) => [graph.nodes[edge.a]!.name, graph.nodes[edge.b]!.id])).toEqual([
      ["main", "prepare@R/helpers.R"],
    ]);
    expect(invokes[0]!.evidence?.strategy).toBe("imported-symbol");
    expect(graph.importCoverage).toMatchObject({ sites: 2, resolved: 1, unresolved: 1, unsupportedLanguages: [] });
  });

  it("wires testthat files to their subjects through source() imports", async () => {
    const graph = await graphFor({
      "R/stats.R": "summarize <- function(x) x\n",
      "tests/testthat/test-stats.R": [
        "source('../../R/stats.R')",
        "test_that('summarize works', {",
        "  summarize(1)",
        "})",
      ].join("\n"),
    });
    const tests = graph.edges.filter((edge) => edge.kind === "tests");
    expect(tests.map((edge) => [graph.nodes[edge.a]!.file, graph.nodes[edge.b]!.file])).toEqual([
      ["tests/testthat/test-stats.R", "R/stats.R"],
    ]);
    const invokes = graph.edges.filter((edge) => edge.kind === "invokes");
    expect(invokes.map((edge) => [graph.nodes[edge.a]!.file, graph.nodes[edge.b]!.id])).toEqual([
      ["tests/testthat/test-stats.R", "summarize@R/stats.R"],
    ]);
  });
});

describe("R graph integration", () => {
  it("indexes R-only roots without ast-grep", async () => {
    const root = fixture({ "main.R": program, "helpers.R": "prepare <- function(x) x\n" });
    vi.stubEnv("FOVEA_AST_GREP", join(root, "missing-ast-grep"));
    const state = await ensureState(root);
    expect(state.files).toEqual(["helpers.R", "main.R"]);
    expect(state.extraction.failed).toEqual([]);
    const trimmed = await focus(root, "trim_price", 1200, { language: "R", kind: "function", fresh: true });
    expect(trimmed.text).toContain("main.R:8");
  });

  it("refreshes R without a binary, but rejects an added AST-dependent source", async () => {
    const root = fixture({ "main.R": "main <- function() 1\n" });
    vi.stubEnv("FOVEA_AST_GREP", join(root, "missing-ast-grep"));
    await ensureState(root);
    writeFileSync(join(root, "main.R"), "main <- function() helper()\nhelper <- function() 1\n");
    const refreshed = await ensureState(root, { hints: ["main.R"], force: true });
    expect(refreshed.graph.nodes.some((node) => node.name === "helper")).toBe(true);
    expect(refreshed.graph.edges.some((edge) => edge.kind === "invokes")).toBe(true);
    expect(refreshed.extraction.failed).toEqual([]);
    writeFileSync(join(root, "new.R"), "added <- function() 2\n");
    expect((await ensureState(root, { hints: ["new.R"], force: true })).files).toContain("new.R");
    writeFileSync(join(root, "api.ts"), "export const api = 1;\n");
    await expect(ensureState(root, { hints: ["api.ts"], force: true })).rejects.toThrow("no usable ast-grep binary");
    rmSync(join(root, "api.ts"));
    expect((await ensureState(root, { force: true })).extraction.failed).toEqual([]);
  });

  it("still rejects a mixed-language cold build when ast-grep is missing", async () => {
    const root = fixture({ "main.R": "main <- function() 1\n", "api.ts": "export const api = 1;\n" });
    vi.stubEnv("FOVEA_AST_GREP", join(root, "missing-ast-grep"));
    await expect(ensureState(root)).rejects.toThrow("no usable ast-grep binary");
  });

  it.skipIf(!hasAstGrep())("keeps mixed-language scans on the consolidated path", async () => {
    const root = fixture({ "stats.R": program, "api.ts": 'export function run() { return fetch("/api/report"); }' });
    const files = ["stats.R", "api.ts"];
    const matches = await scanRules(coreScanRules(files), files, root);
    expect(matches).toBeDefined();
    const facts = await coreFactsFromScan(files, root, makeFileSource(root), matches!);
    expect(facts.calls.some((site) => site.file === "api.ts" && site.callee === "fetch")).toBe(true);
    expect(facts.calls.some((site) => site.file === "stats.R" && site.callee === "trim_price")).toBe(true);
    expect(facts.imports.some((site) => site.file === "stats.R" && site.spec === "dplyr")).toBe(true);
  });

  it("never promotes R path calls into unsupported ast-grep rules or tier-3 sigs", async () => {
    const sources = {
      "one.R": 'run <- function() {\n  Router.get("/one")\n  Router.get("/two")\n}\n',
      "two.R": 'run <- function() {\n  Router.get("/three")\n  Router.get("/four")\n}\n',
    };
    const root = fixture(sources);
    const outcome = await loadFacts(root, Object.keys(sources));
    expect(outcome.report.failed).toEqual([]);
    for (const facts of outcome.store.facts.values()) {
      expect(facts.sigs).toBeUndefined();
      expect(facts.calls).toHaveLength(2);
      expect(facts.literals).toHaveLength(2);
    }
  });

  it("persists and refreshes edited R facts", async () => {
    const sources = { "main.R": "source('./helpers.R')\nmain <- function() prepare(1)\n", "helpers.R": "prepare <- function(x) x\n" };
    const root = fixture(sources);
    const files = Object.keys(sources);
    const first = await loadFacts(root, files);
    expect(first.report.failed).toEqual([]);
    expect(first.dirty).toEqual(files.slice().sort());
    const cached = await loadFacts(root, files);
    expect(cached.dirty).toEqual([]);
    expect(cached.store.facts.get("main.R")).toEqual(first.store.facts.get("main.R"));
    writeFileSync(join(root, "main.R"), sources["main.R"].replace("prepare", "renamed"));
    await refreshFacts(root, cached.store, files, ["main.R"]);
    expect(cached.store.facts.get("main.R")!.calls[0]!.callee).toBe("renamed");
    const graph = (await assembleGraphWithIndex(root, files, cached.store.facts)).graph;
    expect(graph.edges.filter((edge) => edge.kind === "invokes")).toEqual([]);
  });
});
