// R has no ast-grep grammar. Read its assignment-based declarations and
// explicit references directly from source: functions are `name <-
// function(...)` (or `=`), classes are S4 setClass/setGeneric/setMethod or
// R6Class blocks, dependencies are library()/require()/requireNamespace()
// (installed packages, unresolved by design) plus source() file includes.
// R 4.0 raw strings (r"(...)") are not modeled; standard quotes may span lines.
import type { CallSite, ImportSite, LiteralSite, SymbolRec } from "./types.js";

interface RFacts {
  symbols: SymbolRec[];
  imports: ImportSite[];
  calls: CallSite[];
  literals: LiteralSite[];
}

const NAME = "[A-Za-z.][A-Za-z0-9._]*";
const DEF = new RegExp(`^\\s*(${NAME})\\s*(?:<<-|<-|=)\\s*function\\s*\\(`);
const R6_DEF = new RegExp(`^\\s*(${NAME})\\s*(?:<<-|<-|=)\\s*R6Class\\s*\\(`);
// Top-level data assignment: any RHS except a function literal. `==` and
// comparisons never match: `=(?![=>])` rejects the second `=` of `==`.
const ASSIGN = new RegExp(`^\\s*(${NAME})\\s*(?:<<-|<-|=(?![=>]))\\s*(?!function\\s*\\()(?=\\S)`);
// S4 meta objects may be assigned a generator first: Foo <- setClass("Foo").
const SET = (fn: string) => new RegExp(`^\\s*(?:(${NAME})\\s*(?:<<-|<-|=)\\s*)?${fn}\\s*\\(`);
const SET_CLASS = SET("setClass");
const SET_GENERIC = SET("setGeneric");
const SET_METHOD = SET("setMethod");
// Wrapped forms still count: suppressPackageStartupMessages(library(pkg)).
const PACKAGE = /^\s*(?:[A-Za-z.][\w.]*\s*\(\s*)*(library|require|requireNamespace)\s*\(/;
const SOURCE = /^\s*(?:[A-Za-z.][\w.]*\s*\(\s*)*source\s*\(/;
// Qualified calls keep their qualifier whole: pkg::fun(x), self$method(x).
const CALL = new RegExp(`((?:${NAME}(?:::|\\$))+${NAME})\\s*\\(|(${NAME})\\s*\\(`, "g");
// Keywords are syntax, and the dependency forms are recorded as imports.
const CALL_KEYWORDS = new Set([
  "if", "else", "for", "while", "repeat", "function", "return", "switch", "in",
  "next", "break", "library", "require", "requireNamespace", "source",
]);

// Base mega-hubs: the apply family, data constructors, coercion, plumbing.
// Native-reader-only warding (ast-grep languages are unaffected); single-
// letter helpers (c(), t(), I()) fall below the minimum callee length instead.
const R_BASE_HUBS = new Set([ // native-reader-internal since the ward split
  "sapply", "lapply", "vapply", "apply", "tapply", "mapply", "eapply", "rapply",
  "data.frame", "as.data.frame", "matrix", "as.matrix", "as.list", "as.vector",
  "as.numeric", "as.character", "as.integer", "as.logical", "as.factor", "as.date",
  "cbind", "rbind", "unlist", "list", "seq", "seq_len", "seq_along", "rep", "rev",
  "paste", "paste0", "cat", "message", "warning", "stop", "nrow", "ncol",
  "length", "names", "dim", "rownames", "colnames", "levels", "factor", "ordered",
  "is.na", "na.omit", "which", "unique", "duplicated", "order", "subset",
  "aggregate", "do.call", "sort", "split", "table", "head", "tail",
  "grep", "grepl", "sub", "gsub", "strsplit", "nchar", "toupper", "tolower",
  "mean", "median", "var", "sd", "sum", "abs", "round", "sqrt", "exp", "log",
  "is.null", "is.list", "is.vector", "is.character", "is.numeric", "is.factor",
  "is.data.frame", "class", "attr", "attributes", "structure",
  "print", "sprintf", "format", "suppressmessages", "suppresswarnings",
  "suppresspackagemessages",
  // testthat entry points and assertions
  "test_that", "expect_equal", "expect_true", "expect_false", "expect_error",
  "expect_warning", "expect_identical", "expect_named", "expect_length",
  "expect_type", "expect_match", "expect_null", "expect_silent",
  "expect_no_error", "expect_no_warning", "skip_if_not", "skip_if_not_installed",
]);

// First call argument: a quoted name (position-masked in code) or a bare
// package symbol. Returns the resolved text, or undefined for expressions.
const firstArg = (
  code: string,
  from: number,
  strings: ReadonlyArray<{ start: number; text: string }>,
): string | undefined => {
  const quoted = strings.find((s) => s.start >= from);
  if (quoted && code.slice(from, quoted.start).trim() === "") return quoted.text;
  const bare = new RegExp(`^(${NAME})(?=[\\s,)])`).exec(code.slice(from));
  return bare ? bare[1] : undefined;
};

// First quoted argument after the opening paren (setClass("Foo", ...)).
const stringArg = (
  code: string,
  strings: ReadonlyArray<{ start: number; text: string }>,
): string | undefined => {
  const open = code.indexOf("(");
  const quoted = strings.find((s) => s.start > open);
  return quoted && code.slice(open + 1, quoted.start).trim() === "" ? quoted.text : undefined;
};

// Section navigation markers (languageserver convention): `# Name ----` or
// `## Name =====` at top level; roxygen `#'` lines never match.
const SECTION = /^#{1,2}\s+(.+?)\s+[-=]{4,}\s*$/;

export const extractR = (file: string, text: string): RFacts => {
  const facts: RFacts = { symbols: [], imports: [], calls: [], literals: [] };
  // Mirror the pipeline literal dedupe key (file|line|text): a repeated
  // string on one line is one join site, not two.
  const seenLiterals = new Set<string>();
  let depth = 0; // open ( [ { across lines, with strings and comments masked
  const classes: Array<{ name: string; at: number }> = []; // open R6Class blocks
  const lines = text.split("\n");
  // R string literals may span lines (SQL, glue templates): this quote
  // state persists across the line loop below so string bodies stay masked
  // and bracket counting stays honest; unterminated quotes emit nothing.
  let quote = ""; // open delimiter ("" = closed); survives across lines
  let value = ""; // string body accumulated across lines
  let start = -1; // column of the opening quote
  let quoteLine = 1; // 1-based line of the opening quote
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at]!;
    const line = at + 1;
    // Mask comments (#, #!, #') and string bodies, preserving offsets.
    // Escapes consume the following character, including an escaped quote.
    let code = "";
    let visible = "";
    const strings: Array<{ start: number; text: string }> = [];
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (quote) {
        visible += ch;
        code += " ";
        if (ch === "\\" && i + 1 < raw.length) {
          const escaped = raw[++i]!;
          value += ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[escaped] ?? escaped;
          code += " ";
          visible += escaped;
        } else if (ch === quote) {
          if (value.length >= 2 && value.length <= 200 && !seenLiterals.has(`${quoteLine}|${value}`)) {
            seenLiterals.add(`${quoteLine}|${value}`);
            facts.literals.push({ file, line: quoteLine, text: value });
          }
          strings.push({ start, text: value });
          quote = "";
        } else {
          value += ch;
        }
      } else if (ch === "#") {
        break;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        value = "";
        start = i;
        quoteLine = line;
        code += " ";
        visible += ch;
      } else {
        code += ch;
        visible += ch;
      }
    }
    // Section markers live entirely in comments, so `code` is empty and
    // the shared `decl` helper below never sees them; record them directly.
    const section = SECTION.exec(raw);
    if (section && depth === 0 && classes.length === 0) {
      const sig = raw.trim();
      facts.symbols.push({ file, line, name: section[1]!.trim(), kind: "section", sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig, lang: "R" });
    }
    if (!code.trim()) continue;
    const inClass = classes.length > 0 && depth > classes.at(-1)!.at;
    const sig = visible.trim();
    const decl = (name: string, kind: SymbolRec["kind"]): void => {
      facts.symbols.push({ file, line, name, kind, sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig, lang: "R" });
    };
    const r6 = R6_DEF.exec(code);
    if (r6) {
      decl(r6[1]!, "class");
    } else {
      // Top-level assignments define functions; inside an R6Class block the
      // list entries become methods. Other nested forms (argument defaults)
      // are skipped.
      const def = DEF.exec(code);
      if (def && (depth === 0 || inClass)) {
        decl(inClass ? `${classes.at(-1)!.name}.${def[1]}` : def[1]!, inClass ? "method" : "function");
      } else {
        const setClass = SET_CLASS.exec(code);
        const setGeneric = SET_GENERIC.exec(code);
        const setMethod = SET_METHOD.exec(code);
        if (setClass) {
          const name = stringArg(code, strings) ?? setClass[1];
          if (name) decl(name, "class");
        } else if (setGeneric) {
          const name = stringArg(code, strings) ?? setGeneric[1];
          if (name) decl(name, "function");
        } else if (setMethod) {
          const name = stringArg(code, strings) ?? setMethod[1];
          if (name) decl(name, "method");
        } else {
          // Non-function top-level assignments are the data surface of an
          // analysis script: theme <- theme_bw(), counts <- read.csv(...).
          // Nested depth (locals, argument defaults) stays invisible.
          // Match against `visible`, not `code`: a string-literal RHS
          // (PREFIX <- "fig_") is masked to spaces in `code`.
          const assign = ASSIGN.exec(visible);
          if (assign && depth === 0) decl(assign[1]!, "decl");
        }
      }
    }
    const pkg = PACKAGE.exec(code);
    if (pkg) {
      const spec = firstArg(code, pkg[0].length, strings);
      if (spec) facts.imports.push({ file, line, spec });
    }
    const src = SOURCE.exec(code);
    if (src) {
      const spec = firstArg(code, src[0].length, strings);
      if (spec) facts.imports.push({ file, line, spec });
    }
    CALL.lastIndex = 0;
    for (const call of code.matchAll(CALL)) {
      const name = call[1] ?? call[2]!;
      if (name.length <= 1 || CALL_KEYWORDS.has(name) || R_BASE_HUBS.has(name.toLowerCase())) continue;
      facts.calls.push({ file, line, callee: name });
    }
    const depthBefore = depth; // R6 blocks anchor at the pre-line depth: a
    // single-line `R6Class(..., list(` header must not hide its members.
    let net = 0;
    for (const ch of code) {
      if ("([{".includes(ch)) net++;
      else if (")]}".includes(ch)) net--;
    }
    depth = Math.max(0, depth + net);
    while (classes.length && depth <= classes.at(-1)!.at) classes.pop();
    if (r6) classes.push({ name: r6[1]!, at: depthBefore });
  }
  // A generic and its setMethod implementations share a graph identity;
  // likewise a re-assigned name keeps one symbol. First site wins.
  const symbols = new Map<string, SymbolRec>();
  const symbolKey = (symbol: SymbolRec): string => symbol.kind === "section" ? `section:${symbol.name}` : symbol.name;
  for (const symbol of facts.symbols) if (!symbols.has(symbolKey(symbol))) symbols.set(symbolKey(symbol), symbol);
  facts.symbols = [...symbols.values()].sort((a, b) => a.line - b.line);
  return facts;
};
