import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { extractR } from "../src/core/r.js";
import { extractQuarto } from "../src/core/quarto.js";
import { assembleGraphWithIndex } from "../src/core/graph.js";
import { ensureState, evictState } from "../src/core/state.js";
import { cachePathFor, clearPersistTimer } from "../src/core/build.js";

const roots: string[] = [];
const fixture = (sources: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "pi-fovea-r-review-"));
  roots.push(root);
  for (const [file, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    evictState(root);
    clearPersistTimer(root);
    rmSync(root, { recursive: true, force: true });
    rmSync(cachePathFor(root), { force: true });
  }
});

describe("R review regressions", () => {
  it("reads whitespace, named and multiline dependency arguments without inventing dynamic packages", () => {
    const text = [
      "library( dplyr )",
      'library(package = "tibble")',
      'requireNamespace(\n  package = "rlang",\n  quietly = TRUE\n)',
      'source(file = "helpers.R")',
      'source(\n  "init"\n)',
      "source(path)",
      "library(pkg, character.only = TRUE)",
      'library(paste0("d", "plyr"))',
      'library(paste0("d", "plyr"), character.only = TRUE)',
      "# source('phantom.R')",
      'text <- "library(fake)"',
    ].join("\n");
    expect(extractR("main.R", text).imports.map(({ spec, line }) => [spec, line])).toEqual([
      ["dplyr", 1],
      ["tibble", 2],
      ["rlang", 3],
      ["helpers.R", 7],
      ["init", 8],
    ]);
  });

  it("never treats a literal source path as a package or a package name as a local source", async () => {
    const main = extractR("main.R", 'source("init")\nsource(path)\nlibrary("local.R")\n');
    const init = extractR("init", "initialize <- function() 1\n");
    const local = extractR("local.R", "local <- function() 1\n");
    const { graph } = await assembleGraphWithIndex(
      "/unused",
      ["main.R", "init", "local.R"],
      new Map([
        ["main.R", { sha1: "1", anchors: [], ...main }],
        ["init", { sha1: "2", anchors: [], ...init }],
        ["local.R", { sha1: "3", anchors: [], ...local }],
      ]),
    );
    expect(graph.nodes.filter((n) => n.kind === "package").map((n) => n.name)).toEqual(["local.R"]);
    expect(
      graph.edges
        .filter((e) => e.kind === "imports" && graph.nodes[e.b]!.kind === "file")
        .map((e) => graph.nodes[e.b]!.file),
    ).toEqual(["init"]);
  });

  it("recognizes namespaced R6 classes and split assignments", () => {
    const text = [
      'Wallet <- R6::R6Class("Wallet", public = list(',
      "  deposit = function(amount) amount",
      "))",
      "Other <-",
      '  R6::R6Class("Other", public = list(',
      "    withdraw = function(amount) amount",
      "  ))",
    ].join("\n");
    expect(extractR("classes.R", text).symbols.map(({ name, kind }) => [name, kind])).toEqual([
      ["Wallet", "class"],
      ["Wallet.deposit", "method"],
      ["Other", "class"],
      ["Other.withdraw", "method"],
    ]);
  });

  for (const git of [false, true])
    it(`refreshes DESCRIPTION-only changes in a ${git ? "Git" : "plain"} root`, async () => {
      const root = fixture({
        "main.R": "library(dplyr)\n",
        DESCRIPTION: "Package: demo\nImports: stats\n",
      });
      if (git) {
        execFileSync("git", ["init", "-q", root]);
        execFileSync("git", ["-C", root, "add", "."]);
        execFileSync("git", [
          "-C",
          root,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-qm",
          "fixture",
        ]);
      }
      const sig = (state: Awaited<ReturnType<typeof ensureState>>) =>
        state.graph.nodes.find((n) => n.id === "pkg:dplyr")!.sig;
      const before = await ensureState(root);
      expect(sig(before)).toContain("used without DESCRIPTION entry");
      writeFileSync(join(root, "DESCRIPTION"), "Package: demo\nImports: stats, dplyr\n");
      const after = await ensureState(root, { hints: ["DESCRIPTION"], force: true });
      expect(sig(after)).toContain("declared in DESCRIPTION");
      expect(after.facts["main.R"]).toBe(before.facts["main.R"]);
      expect(after.version).not.toBe(before.version);
      rmSync(join(root, "DESCRIPTION"));
      const removed = await ensureState(root);
      expect(sig(removed)).toBe("R package dplyr");
      writeFileSync(join(root, "DESCRIPTION"), "Package: demo\nImports: stats\n");
      expect(sig(await ensureState(root))).toContain("used without DESCRIPTION entry");
    });

  it("does not resolve R calls to unrelated Python declarations", async () => {
    const r = extractR("main.R", "run <- function() python_only()\n");
    const { graph } = await assembleGraphWithIndex(
      "/unused",
      ["main.R", "other.py"],
      new Map([
        ["main.R", { sha1: "1", anchors: [], ...r }],
        [
          "other.py",
          {
            sha1: "2",
            anchors: [],
            imports: [],
            calls: [],
            literals: [],
            symbols: [
              {
                file: "other.py",
                name: "python_only",
                kind: "function" as const,
                line: 1,
                sig: "def python_only():",
                lang: "Python",
              },
            ],
          },
        ],
      ]),
    );
    expect(graph.edges.filter((e) => e.kind === "invokes")).toEqual([]);
  });

  it("indexes indented and tilde chunks, option labels and every Python module", () => {
    const text = [
      "  ```{r}",
      "  #| label: setup",
      "  prep <- function(x) x",
      "  ```",
      "~~~{python}",
      "import numpy as np, pandas as pd",
      "from scipy.stats import norm",
      "~~~",
      "~~~~{r final}",
      "done <- function() 1",
      "~~~", // short delimiter is body, not close
      "~~~~",
    ].join("\n");
    const facts = extractQuarto("nb.qmd", text);
    expect(facts.symbols.map(({ name, line, chunkLabel }) => [name, line, chunkLabel])).toEqual([
      ["prep", 3, "setup"],
      ["done", 10, "final"],
    ]);
    expect(facts.imports.map(({ spec, line }) => [spec, line])).toEqual([
      ["numpy", 6],
      ["pandas", 6],
      ["scipy.stats", 7],
    ]);
  });

  it("does not read cell labels from code or string bodies", () => {
    const facts = extractQuarto(
      "nb.qmd",
      [
        "```{r real}",
        'query <- "first line',
        "#| label: fake",
        'last line"',
        "prep <- function(x) x",
        "```",
      ].join("\n"),
    );
    expect(facts.symbols.every((symbol) => symbol.chunkLabel === "real")).toBe(true);
    expect(facts.literals[0]!.text).toBe("first line\n#| label: fake\nlast line");
  });

  it("keeps same-named sections in different chunks distinct", async () => {
    const facts = extractQuarto(
      "nb.qmd",
      "```{r one}\n# Setup ----\n```\n```{r two}\n# Setup ----\n```",
    );
    const { graph } = await assembleGraphWithIndex(
      "/unused",
      ["nb.qmd"],
      new Map([["nb.qmd", { sha1: "1", anchors: [], ...facts }]]),
    );
    expect(
      graph.nodes.filter((n) => n.kind === "section").map((n) => [n.id, n.chunkLabel]),
    ).toEqual([
      ["section:Setup@nb.qmd@chunk:1", "one"],
      ["section:Setup@nb.qmd@chunk:2", "two"],
    ]);
  });
});
