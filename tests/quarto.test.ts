import { describe, expect, it } from "vitest";
import { extractQuarto } from "../src/core/quarto.js";
import { extractR } from "../src/core/r.js";
import { assembleGraphWithIndex } from "../src/core/graph.js";
import { formatNodeLocation } from "../src/core/render.js";
import { langOf } from "../src/core/astgrep.js";
import { filterSupported, type FileFacts } from "../src/core/build.js";
import type { Graph } from "../src/core/types.js";

const notebook = [
  "---",
  "title: notebook",
  "---",
  "",
  'Prose with `code` and "strings".',
  "",
  "```{r setup}",
  "library(dplyr)",
  "theme <- theme_bw()",
  "prep <- function(df) {",
  "  df",
  "}",
  "```",
  "",
  "```{python}",
  "import pandas as pd",
  "from scipy import stats",
  "```",
  "",
  "```",
  "ignored <- function(y) y",
  "```",
  "",
  "```{bash}",
  "echo ignored",
  "```",
  "",
  "```{r analysis}",
  "result <- prep(df)",
  "```",
].join("\n");

const factsFor = (file: string, text: string): FileFacts =>
  file.endsWith(".qmd") || file.endsWith(".rmd")
    ? { sha1: "fixture", anchors: [], ...extractQuarto(file, text) }
    : { sha1: "fixture", anchors: [], ...extractR(file, text) };

const graphFor = async (sources: Record<string, string>): Promise<Graph> => {
  const facts = new Map<string, FileFacts>();
  for (const [file, text] of Object.entries(sources)) facts.set(file, factsFor(file, text));
  return (await assembleGraphWithIndex("/unused", Object.keys(sources), facts)).graph;
};

describe("Quarto notebook reader", () => {
  it("registers .qmd/.Rmd as a native source language", () => {
    expect(langOf("ana/gw_ana.qmd")).toBe("Quarto");
    expect(langOf("notes.Rmd")).toBe("Quarto");
    expect(filterSupported(["a.qmd", "b.rmd", "c.xyz"])).toEqual(["a.qmd", "b.rmd"]);
  });

  it("indexes R chunks at absolute lines with chunk attribution", () => {
    const facts = extractQuarto("ana/gw_ana.qmd", notebook);
    expect(facts.symbols.map(({ name, kind, line, chunk }) => [name, kind, line, chunk])).toEqual([
      ["theme", "decl", 9, 1],
      ["prep", "function", 10, 1],
      ["result", "decl", 29, 3], // python chunk numbered 2; bash/md never count
    ]);
    expect(facts.imports.map(({ spec, line }) => [spec, line])).toEqual([
      ["dplyr", 8],
      ["pandas", 16],
      ["scipy", 17],
    ]);
    expect(facts.calls.map(({ callee, line }) => [callee, line])).toEqual([
      ["theme_bw", 9],
      ["prep", 29],
    ]);
    expect(facts.literals).toEqual([]); // prose strings stay markdown
  });

  it("matches fence lengths and skips example blocks", () => {
    const nb = [
      "````{r real}",
      "a <- function(x) x",
      "```", // 3 < 4: content, not a close
      "b <- function(x) x",
      "````", // closes the 4-backtick chunk
      "````", // bare 4-fence: markdown example begins
      "```{r fake}", // displayed literally: skipped
      "phantom <- function(x) x",
      "```", // 3 < 4: does not close the example
      "````", // closes the example
      "```{bash}", // non-target opener: skipped block
      "echo ignored",
      "```",
      "```{r after}",
      "c <- function(x) x",
      "```",
    ].join("\n");
    const facts = extractQuarto("fences.qmd", nb);
    expect(facts.symbols.map(({ name, chunk, chunkLabel }) => [name, chunk, chunkLabel])).toEqual([
      ["a", 1, "real"],
      ["b", 1, "real"],
      ["c", 2, "after"],
    ]);
  });

  it("accepts indented close fences and skips tilde-fenced examples", () => {
    const nb = [
      "```{r indented}",
      "a <- function(x) x",
      "  ```", // two-space indent: legal close (CommonMark allows 3)
      "~~~", // tilde example begins
      "```{r fake}", // displayed literally: must be skipped
      "phantom <- function(x) x",
      "~~~", // closes the tilde example
      "```{r real}",
      "b <- function(x) x",
      "```",
    ].join("\n");
    const facts = extractQuarto("fences2.qmd", nb);
    expect(facts.symbols.map(({ name, chunk, chunkLabel }) => [name, chunk, chunkLabel])).toEqual([
      ["a", 1, "indented"],
      ["b", 2, "real"],
    ]);
  });

  it("carries knitr chunk labels into attribution", () => {
    const nb = [
      "```{r setup}",
      "prep <- function(df) df",
      "```",
      "```{r echo=FALSE}",
      "quiet <- function(x) x", // option-only header: no label
      "```",
      "```{r analysis, dev=png}",
      "final <- function(x) x",
      "```",
    ].join("\n");
    const facts = extractQuarto("ana/nb.qmd", nb);
    expect(facts.symbols.map(({ name, chunk, chunkLabel }) => [name, chunk, chunkLabel])).toEqual([
      ["prep", 1, "setup"],
      ["quiet", 2, undefined],
      ["final", 3, "analysis"],
    ]);
  });

  it("joins symbols, chunks and source() includes into the graph", async () => {
    const graph = await graphFor({
      "ana/gw_ana.qmd": notebook,
      "ana/helpers.R": "prepare <- function(x) x\n",
    });
    const fileNode = graph.nodes.find((n) => n.file === "ana/gw_ana.qmd" && n.kind === "file");
    expect(fileNode?.lang).toBe("Quarto");
    const prep = graph.nodes.find((n) => n.name === "prep");
    expect(prep && formatNodeLocation(prep)).toBe("ana/gw_ana.qmd#chunk-setup:10");
    const result = graph.nodes.find((n) => n.name === "result");
    expect(result && formatNodeLocation(result)).toBe("ana/gw_ana.qmd#chunk-analysis:29");

    const nb = ["```{r}", 'source("./helpers.R")', "run <- function() prepare(1)", "```"].join("\n");
    const joined = await graphFor({ "ana/run.qmd": nb, "ana/helpers.R": "prepare <- function(x) x\n" });
    const invokes = joined.edges.filter((edge) => edge.kind === "invokes");
    expect(invokes.map((edge) => [joined.nodes[edge.a]!.name, joined.nodes[edge.b]!.id])).toEqual([
      ["run", "prepare@ana/helpers.R"],
    ]);
  });

  it("keeps same-named symbols in different chunks as distinct nodes", async () => {
    const nb = [
      "```{r prep-a}",
      "run <- function(x) x + 1",
      "```",
      "",
      "```{r prep-b}",
      "run <- function(x) x + 2",
      "```",
    ].join("\n");
    const graph = await graphFor({ "nb.qmd": nb });
    const runs = graph.nodes.filter((n) => n.file === "nb.qmd" && n.name === "run" && n.kind === "function");
    expect(runs.map((n) => [n.id, n.line, n.chunkLabel])).toEqual([
      ["run@nb.qmd@chunk:1", 2, "prep-a"],
      ["run@nb.qmd@chunk:2", 6, "prep-b"],
    ]);
  });
});
