import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAstGrep, langOf, scanRules } from "../src/core/astgrep.js";
import { extractR } from "../src/core/r.js";
import {
  cachePathFor,
  clearPersistTimer,
  filterSupported,
  loadFacts,
  refreshFacts,
  type FileFacts,
} from "../src/core/build.js";
import {
  coreFactsFromScan,
  coreScanRules,
  extractCalls,
  extractImports,
  extractLiterals,
  extractSymbols,
  isTestFile,
  supportsImportExtraction,
} from "../src/core/extract.js";
import { assembleGraphWithIndex } from "../src/core/graph.js";
import { ensureState, evictState, focus, sketch } from "../src/core/ops.js";
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
    expect(filterSupported(["stats.R", "helpers.r", "unknown.xyz"])).toEqual([
      "stats.R",
      "helpers.r",
    ]);
    expect(supportsImportExtraction("R")).toBe(true);
    expect(isTestFile("tests/testthat/test-stats.R")).toBe(true);
    expect(isTestFile("tests/testthat.R")).toBe(true);
    expect(isTestFile("tests/testthat/helper-data.R")).toBe(true);
    expect(isTestFile("R/stats.R")).toBe(false);
    expect(coreScanRules(["stats.R"])).toEqual([]);
    expect(
      coreScanRules(["stats.R", "api.ts"]).every((rule) => rule.language === "TypeScript"),
    ).toBe(true);
  });

  it("extracts functions, S4 generics, R6 methods and exact lines", () => {
    const facts = extractR("stats.R", program);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["trim_price", "function", 8],
      ["fit_model", "function", 13],
      ["summary_stats", "function", 18],
      ["Account", "class", 22],
      ["deposit", "function", 23],
      ["Wallet", "class", 31],
      ["Wallet.initialize", "method", 34],
      ["Wallet.deposit", "method", 37],
      ["run_report", "function", 44],
    ]);
    expect(facts.symbols.every((symbol) => symbol.lang === "R")).toBe(true);
    expect(facts.imports).toEqual([
      { file: "stats.R", line: 3, spec: "dplyr", form: "r-package" },
      { file: "stats.R", line: 4, spec: "stringr", form: "r-package" },
      { file: "stats.R", line: 5, spec: "tibble", form: "r-package" },
      { file: "stats.R", line: 6, spec: "./helpers.R", form: "r-source" },
    ]);
    expect(facts.calls.map(({ callee, line }) => [callee, line])).toEqual([
      ["glm", 14],
      ["setClass", 22],
      ["setGeneric", 23],
      ["standardGeneric", 23],
      ["setMethod", 24],
      ["signature", 25],
      ["R6Class", 31],
      ["invisible", 39],
      ["read.csv", 45],
      ["trim_price", 46],
      ["dplyr::mutate", 47],
      ["str_detect", 49],
    ]);
    expect(facts.literals.map((site) => [site.text, site.line])).toEqual([
      ["stringr", 4],
      ["tibble", 5],
      ["./helpers.R", 6],
      ["NA", 8],
      ["USD", 10],
      ["Account", 22],
      ["character", 22],
      ["numeric", 22],
      ["deposit", 23],
      ["deposit", 24],
      ["Account", 25],
      ["Wallet", 31],
      ["/api/report", 44],
      ["EUR", 47],
      ["total: ", 48],
      ["^\\d+", 49],
    ]);
  });

  it("masks comments, escaped quotes and base mega-hub noise", () => {
    const text = [
      "#!/usr/bin/env Rscript",
      'x <- "quoted # not a comment" # real() comment',
      "eq == function(x) x",
      "c(1, 2)",
      "sapply(x, function(i) i)",
      "y <- 'single \"quoted\"'",
    ].join("\n");
    const facts = extractR("edge.R", text);
    // Top-level data assignments are decls; the `eq ==` comparison is not.
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["x", "decl", 2],
      ["y", "decl", 6],
    ]);
    expect(facts.calls).toEqual([]);
    expect(facts.literals.map((site) => site.text)).toEqual([
      "quoted # not a comment",
      'single "quoted"',
    ]);
  });

  it("records non-function top-level assignments as data decls", () => {
    const text = [
      "library(ggplot2)",
      'theme <- theme_bw() + theme(legend.position = "bottom")',
      'codon_table <- read.csv("data/codons.csv")',
      'SAMPLES <<- c("A", "B")',
      "eq == function(x) x", // comparison, never an assignment
      "for (i in 1:3) {",
      "  loop_local <- i", // depth > 0: local stays invisible
      "}",
      "calc_usage <- function(x) x", // function form still wins
    ].join("\n");
    const facts = extractR("data.R", text);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["theme", "decl", 2],
      ["codon_table", "decl", 3],
      ["SAMPLES", "decl", 4],
      ["calc_usage", "function", 9],
    ]);
  });

  it("keeps depth honest across multi-line R strings", () => {
    const text = [
      'dbGetQuery(con, "SELECT *',
      '  FROM t WHERE id IN (1, 2)")',
      "after_sql <- function(x) x",
    ].join("\n");
    const facts = extractR("sql.R", text);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["after_sql", "function", 3],
    ]);
    expect(facts.literals.map(({ text: t, line }) => [t, line])).toEqual([
      ["SELECT *  FROM t WHERE id IN (1, 2)", 1],
    ]);
    expect(facts.calls.map(({ callee }) => callee)).toEqual(["dbGetQuery"]);
  });

  it("records R6 methods after a single-line class header", () => {
    const text = [
      'Wallet <- R6Class("Wallet", public = list(',
      "  deposit = function(amount) amount",
      "))",
    ].join("\n");
    const facts = extractR("r6.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["Wallet", "class"],
      ["Wallet.deposit", "method"],
    ]);
  });

  it("does not let a closed single-line R6Class swallow the next section", () => {
    const text = ['Base <- R6Class("Base")', "", "# Helpers ----", "f <- function(x) x"].join("\n");
    const facts = extractR("r6one.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["Base", "class"],
      ["Helpers", "section"],
      ["f", "function"],
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

  it("masks R 4.0 raw strings so inner quotes and brackets stay honest", () => {
    const text = [
      'sql <- r"(SELECT a " b ( c FROM t)"',
      "real_fn <- function(x) x",
      'label <- R"[contains ] bracket]"',
      "other <- function(y) y",
    ].join("\n");
    const facts = extractR("raw.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["sql", "decl"],
      ["real_fn", "function"],
      ["label", "decl"],
      ["other", "function"],
    ]);
    expect(facts.literals.map((site) => site.text)).toEqual([
      'SELECT a " b ( c FROM t',
      "contains ] bracket",
    ]);
  });

  it("masks multi-line raw strings with dash delimiters", () => {
    const text = [
      'query <- r"--(SELECT [col]',
      '  FROM t WHERE x = 1)--"',
      "after <- function(x) x",
    ].join("\n");
    const facts = extractR("rawml.R", text);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["query", "decl", 1],
      ["after", "function", 3],
    ]);
    expect(facts.literals).toEqual([
      { file: "rawml.R", line: 1, text: "SELECT [col]  FROM t WHERE x = 1" },
    ]);
  });

  it("records backtick and quoted operator definitions", () => {
    const text = [
      "`%+%` <- function(x, y) x",
      '"%>%" <- function(lhs, rhs) rhs',
      "`%||%` = function(a, b) b",
    ].join("\n");
    const facts = extractR("ops.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["%+%", "function"],
      ["%>%", "function"],
      ["%||%", "function"],
    ]);
  });

  it("records functions split across the assignment and the literal", () => {
    const text = [
      "long_name <-",
      "  function(x) {",
      "    x",
      "  }",
      "delayed <-",
      "",
      "  function(y) y",
      "Wallet <-",
      '  R6Class("Wallet")',
    ].join("\n");
    const facts = extractR("split.R", text);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["long_name", "function", 1],
      ["delayed", "function", 5],
      ["Wallet", "class", 8],
    ]);
  });

  it("records right-assignment definitions without string forgeries", () => {
    const text = [
      "function(x) x -> make_id",
      "TOTAL ->> cap",
      "fn <- function(s) paste(s, 'a -> b')",
    ].join("\n");
    const facts = extractR("right.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["make_id", "function"],
      ["cap", "decl"],
      ["fn", "function"],
    ]);
  });

  it("accepts deeper hash headers and hash terminators for sections", () => {
    const text = ["### Deep section ----", "f <- function(x) x", "# Data ####"].join("\n");
    const facts = extractR("deep.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["Deep section", "section"],
      ["f", "function"],
      ["Data", "section"],
    ]);
  });

  it("does not emit section markers from inside multi-line strings", () => {
    const text = ['sql <- "SELECT 1', "# Query ----", '"', "real <- function(x) x"].join("\n");
    const facts = extractR("strsec.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["sql", "decl"],
      ["real", "function"],
    ]);
  });

  it("never resolves calls to section markers", async () => {
    const graph = await graphFor({
      "a.R": "# Fit ----\nFit <- function(x) x\nrun <- function() Fit(1)\n",
    });
    const invokes = graph.edges.filter((edge) => edge.kind === "invokes");
    expect(invokes.map((edge) => [graph.nodes[edge.a]!.id, graph.nodes[edge.b]!.id])).toEqual([
      ["run@a.R", "Fit@a.R"],
    ]);
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
      imports: native.imports,
      calls: native.calls,
      literals: native.literals,
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
    expect(graph.importCoverage).toMatchObject({
      sites: 2,
      resolved: 1,
      unresolved: 1,
      unsupportedLanguages: [],
    });
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
    const trimmed = await focus(root, "trim_price", 1200, {
      language: "R",
      kind: "function",
      fresh: true,
    });
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
    await expect(ensureState(root, { hints: ["api.ts"], force: true })).rejects.toThrow(
      "no usable ast-grep binary",
    );
    rmSync(join(root, "api.ts"));
    expect((await ensureState(root, { force: true })).extraction.failed).toEqual([]);
  });

  it("still rejects a mixed-language cold build when ast-grep is missing", async () => {
    const root = fixture({
      "main.R": "main <- function() 1\n",
      "api.ts": "export const api = 1;\n",
    });
    vi.stubEnv("FOVEA_AST_GREP", join(root, "missing-ast-grep"));
    await expect(ensureState(root)).rejects.toThrow("no usable ast-grep binary");
  });

  it("skips renv and packrat vendored libraries during discovery", async () => {
    const root = fixture({
      "R/main.R": "main <- function() 1\n",
      "renv/library/dplyr/R/arrange.R": "arrange <- function(x) x\n",
      "packrat/lib-demo/R/fit.R": "fit <- function(x) x\n",
    });
    vi.stubEnv("FOVEA_AST_GREP", join(root, "missing-ast-grep"));
    const state = await ensureState(root);
    expect(state.files).toEqual(["R/main.R"]);
  });

  it.skipIf(!hasAstGrep())("keeps mixed-language scans on the consolidated path", async () => {
    const root = fixture({
      "stats.R": program,
      "api.ts": 'export function run() { return fetch("/api/report"); }',
    });
    const files = ["stats.R", "api.ts"];
    const matches = await scanRules(coreScanRules(files), files, root);
    expect(matches).toBeDefined();
    const facts = await coreFactsFromScan(files, root, makeFileSource(root), matches!);
    expect(facts.calls.some((site) => site.file === "api.ts" && site.callee === "fetch")).toBe(
      true,
    );
    expect(
      facts.calls.some((site) => site.file === "stats.R" && site.callee === "trim_price"),
    ).toBe(true);
    expect(facts.imports.some((site) => site.file === "stats.R" && site.spec === "dplyr")).toBe(
      true,
    );
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
    const sources = {
      "main.R": "source('./helpers.R')\nmain <- function() prepare(1)\n",
      "helpers.R": "prepare <- function(x) x\n",
    };
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

describe("R package edges", () => {
  it("surfaces library() and pkg:: usage as pkg:x nodes with per-file strategies", async () => {
    const graph = await graphFor({
      "R/main.R": [
        "library(dplyr)",
        "requireNamespace('tibble')",
        "main <- function() {",
        "  dplyr::mutate(data)",
        "}",
        "stats::rnorm(3)",
      ].join("\n"),
      "R/plot.R": ["library(ggplot2)", "plot_it <- function(x) x"].join("\n"),
    });
    const pkgs = graph.nodes.filter((n) => n.kind === "package");
    expect(pkgs.map((p) => p.id).sort()).toEqual([
      "pkg:dplyr",
      "pkg:ggplot2",
      "pkg:stats",
      "pkg:tibble",
    ]);
    const pkgEdges = graph.edges
      .filter((edge) => graph.nodes[edge.b]!.kind === "package")
      .map((edge) => [
        graph.nodes[edge.a]!.file,
        graph.nodes[edge.b]!.name,
        edge.evidence?.strategy,
      ])
      .sort();
    expect(pkgEdges).toEqual([
      ["R/main.R", "dplyr", "package-import"],
      ["R/main.R", "stats", "qualified-call"],
      ["R/main.R", "tibble", "package-import"],
      ["R/plot.R", "ggplot2", "package-import"],
    ]);
    // graphFor's root has no DESCRIPTION: no declaration state in the sig.
    expect(pkgs.find((p) => p.name === "dplyr")?.sig).toBe("R package dplyr");
  });

  it("admits dotted CRAN package names while file-like specs stay rejected", async () => {
    const graph = await graphFor({
      "R/dotted.R": ["library(data.tree)", "source('helpers.R')"].join("\n"),
    });
    const pkgs = graph.nodes.filter((n) => n.kind === "package");
    expect(pkgs.map((p) => p.id)).toEqual(["pkg:data.tree"]);
  });

  it("counts Suggests: declarations and never invents packages from file specs", async () => {
    const root = fixture({
      DESCRIPTION: "Package: demo\nSuggests: testthat\n",
      "R/a.R": "library(testthat)\nsource('missing.R')\n",
    });
    const { store } = await loadFacts(root, ["R/a.R"]);
    const { graph } = await assembleGraphWithIndex(root, ["R/a.R"], store.facts);
    const sig = (name: string): string | undefined =>
      graph.nodes.find((n) => n.id === `pkg:${name}`)?.sig;
    expect(sig("testthat")).toBe("R package testthat · declared in DESCRIPTION");
    expect(graph.nodes.some((n) => n.id === "pkg:missing.R")).toBe(false);
  });

  it("marks declared vs undeclared packages from DESCRIPTION", async () => {
    const root = fixture({
      DESCRIPTION: "Package: demo\nImports: ggplot2 (>= 3.4)\nDepends: R (>= 4.0), methods\n",
      "R/a.R": "library(ggplot2)\nlibrary(seqinr)\n",
    });
    const { store } = await loadFacts(root, ["R/a.R"]);
    const { graph } = await assembleGraphWithIndex(root, ["R/a.R"], store.facts);
    const sig = (name: string): string | undefined =>
      graph.nodes.find((n) => n.id === `pkg:${name}`)?.sig;
    expect(sig("ggplot2")).toBe("R package ggplot2 · declared in DESCRIPTION");
    expect(sig("seqinr")).toBe("R package seqinr · used without DESCRIPTION entry");
    // Declared but unused (methods) creates no node: nodes come from usage.
    expect(graph.nodes.some((n) => n.id === "pkg:methods")).toBe(false);
  });

  it("labels base R packages instead of missing DESCRIPTION entries", async () => {
    const root = fixture({
      DESCRIPTION: "Package: demo\nImports: dplyr\n",
      "R/a.R": "library(dplyr)\nf <- function() stats::rnorm(1)\n",
    });
    const { store } = await loadFacts(root, ["R/a.R"]);
    const { graph } = await assembleGraphWithIndex(root, ["R/a.R"], store.facts);
    const sig = (name: string): string | undefined =>
      graph.nodes.find((n) => n.id === `pkg:${name}`)?.sig;
    expect(sig("dplyr")).toBe("R package dplyr · declared in DESCRIPTION");
    expect(sig("stats")).toBe("R package stats · base package");
  });

  it("rejects non-file and oversized DESCRIPTION metadata as unknown", async () => {
    const root = fixture({ "R/a.R": "library(ggplot2)\n" });
    const sig = async (): Promise<string | undefined> => {
      const { store } = await loadFacts(root, ["R/a.R"]);
      const { graph } = await assembleGraphWithIndex(root, ["R/a.R"], store.facts);
      return graph.nodes.find((n) => n.id === "pkg:ggplot2")?.sig;
    };
    mkdirSync(join(root, "DESCRIPTION")); // a directory is not metadata
    expect(await sig()).toBe("R package ggplot2");
    rmSync(join(root, "DESCRIPTION"), { recursive: true });
    writeFileSync(join(root, "DESCRIPTION"), `X: ${"a".repeat(256 * 1024 + 16)}\n`);
    expect(await sig()).toBe("R package ggplot2");
  });

  it("records top-level section markers and skips nested ones", () => {
    const text = [
      "# Setup ----",
      "helper <- function(x) {",
      "  # inner note ----", // nested: never a navigation section
      "  x",
      "}",
      "## Data prep =====",
      "#' roxygen ----", // roxygen comment: not a section
    ].join("\n");
    const facts = extractR("sections.R", text);
    expect(facts.symbols.map(({ name, kind, line }) => [name, kind, line])).toEqual([
      ["Setup", "section", 1],
      ["helper", "function", 2],
      ["Data prep", "section", 6],
    ]);
  });

  it("keeps a section and a same-named function as distinct symbols", async () => {
    const text = ["# Fit ----", "Fit <- function(x) x"].join("\n");
    const facts = extractR("fit.R", text);
    expect(facts.symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["Fit", "section"],
      ["Fit", "function"],
    ]);
    const graph = await graphFor({ "fit.R": text });
    const ids = graph.nodes.filter((n) => n.file === "fit.R" && n.name === "Fit").map((n) => n.id);
    expect(new Set(ids)).toEqual(new Set(["section:Fit@fit.R", "Fit@fit.R"]));
  });

  it("wires testthat files by naming convention without source()", async () => {
    const graph = await graphFor({
      "R/stats.R": "summarize <- function(x) x\n",
      "tests/testthat/test-stats.R": [
        "test_that('summarize works', {",
        "  summarize(1)",
        "})",
      ].join("\n"),
    });
    const tests = graph.edges.filter((edge) => edge.kind === "tests");
    expect(
      tests.map((edge) => [
        graph.nodes[edge.a]!.file,
        graph.nodes[edge.b]!.file,
        edge.evidence?.strategy,
      ]),
    ).toEqual([["tests/testthat/test-stats.R", "R/stats.R", "test-naming-convention"]]);
  });

  it("scopes focus by an inline lang: prefix or a language option", async () => {
    const root = fixture({
      "ana/fetch_enrichment.py": "def fetch_enrichment_data():\n    return 1\n",
      "ana/run_enrichment.R": "library(clusterProfiler)\nenrichment_run <- function(df) df\n",
    });
    const both = await focus(root, "enrichment", 700, { fresh: true });
    expect(both.text).toContain("fetch_enrichment_data");
    expect(both.text).toContain("enrichment_run");
    const rOnly = await focus(root, "lang:r enrichment", 700, { fresh: true });
    expect(rOnly.text).toContain("enrichment_run");
    expect(rOnly.text).not.toContain("fetch_enrichment_data");
    // "Quarto" also matches notebook symbols (their lang is the chunk engine).
    const root2 = fixture({
      "nb.qmd": "```{r}\nprep <- function(df) df\n```",
      "plain.R": "prep <- function(x) x",
    });
    const fo2 = await focus(root2, "prep", 700, { language: "Quarto", fresh: true });
    expect(fo2.text).toContain("nb.qmd");
    expect(fo2.text).not.toContain("plain.R");
    // An explicit option wins over the inline prefix.
    const pyOption = await focus(root, "lang:r enrichment", 700, {
      language: "Python",
      fresh: true,
    });
    expect(pyOption.text).toContain("fetch_enrichment_data");
    expect(pyOption.text).not.toContain("enrichment_run");
  });

  it("describes mixed-language region composition in sketch", async () => {
    const sources: Record<string, string> = {
      "ana/define_sets.py":
        'gene_sets = load("gene_sets")\ndef export_sets():\n    return gene_sets\n',
      "ana/fetch_sets.py": 'def fetch_sets():\n    return "gene_sets"\n',
    };
    for (let i = 1; i <= 30; i++) {
      const n = String(i).padStart(2, "0");
      sources[`ana/calc_${n}.R`] =
        `read_sets <- function(x) "gene_sets"\nplot_${n} <- function(df) df\n`;
    }
    const root = fixture(sources);
    await ensureState(root);
    const out = await sketch(root, 1600);
    expect(out.text).toContain("ana/ 32 files [R30/py2]");
    // Pure directories and monolingual basins render exactly as before.
    const pure = await sketch(root, 1600); // same repo: no [ in any other group
    expect((pure.text.match(/ \[/g) ?? []).length).toBe(1);
  });

  it("keeps package nodes out of sketch regions but focus-reachable", async () => {
    const root = fixture({
      "R/a.R": "library(ggplot2)\nf <- function() 1\n",
      "R/b.R": "library(ggplot2)\ng <- function() 2\n",
    });
    await ensureState(root);
    const out = await sketch(root, 1200);
    expect(out.text).not.toContain("(external)");
    const fo = await focus(root, "ggplot2", 800, { fresh: true });
    expect(fo.text).toContain("R package ggplot2");
    expect(fo.text).toContain("(external)");
    expect(fo.text).toContain("package-import/r-library:ggplot2");
  });
});
