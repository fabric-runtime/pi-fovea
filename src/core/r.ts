// R has no ast-grep grammar. Read its assignment-based declarations and
// explicit references directly from source: functions are `name <-
// function(...)` (or `=`), classes are S4 setClass/setGeneric/setMethod or
// R6Class blocks, dependencies are library()/require()/requireNamespace()
// (installed packages, unresolved by design) plus source() file includes.
// R 4.0 raw strings (r"(...)", R'[...]', dash delimiters) are masked like
// standard quotes; both may span lines.
import type { CallSite, ImportSite, LiteralSite, SymbolRec } from "./types.js";

interface RFacts {
  symbols: SymbolRec[];
  imports: ImportSite[];
  calls: CallSite[];
  literals: LiteralSite[];
}

// Bare identifiers name most declarations; R's documented backtick syntax
// (`%+%`, `my fn`) and quoted names ("%>%") are declaration targets too.
// Call/argument surfaces stay bare: package names are never quoted there.
const BARE = "[A-Za-z.][A-Za-z0-9._]*";
const QUOTED = /`(?:[^`\\]|\\.)+`|"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+'/.source;
const LHS = `(?:${BARE}|${QUOTED})`;
const NAME = BARE;
const unquote = (name: string): string =>
  /^[`"']/.test(name) ? name.slice(1, -1).replace(/\\(.)/g, "$1") : name;
const DEF = new RegExp(`^\\s*(${LHS})\\s*(?:<<-|<-|=)\\s*function\\s*\\(`);
const R6_DEF = new RegExp(`^\\s*(${LHS})\\s*(?:<<-|<-|=)\\s*(?:R6::)?R6Class\\s*\\(`);
// Top-level data assignment: any RHS except a function literal. `==` and
// comparisons never match: `=(?![=>])` rejects the second `=` of `==`.
const ASSIGN = new RegExp(`^\\s*(${LHS})\\s*(?:<<-|<-|=(?![=>]))\\s*(?!function\\s*\\()(?=\\S)`);
// `name <-` alone defers to the next non-blank line: f <-\n  function(x) x
// splits long signatures. Right assignments are single-line forms.
const PENDING_ASSIGN = new RegExp(`^\\s*(${LHS})\\s*(?:<<-|<-|=)\\s*$`);
const RIGHT_FN = new RegExp(`^\\s*function\\s*\\([^)]*\\).*->>?\\s*(${BARE})\\s*$`);
const RIGHT_ASSIGN = new RegExp(`^\\s*(?!function\\b)(\\S.*?)\\s*->>?\\s*(${BARE})\\s*$`);
// S4 meta objects may be assigned a generator first: Foo <- setClass("Foo").
const SET = (fn: string) => new RegExp(`^\\s*(?:(${LHS})\\s*(?:<<-|<-|=)\\s*)?${fn}\\s*\\(`);
const SET_CLASS = SET("setClass");
const SET_GENERIC = SET("setGeneric");
const SET_METHOD = SET("setMethod");
// Wrapped forms still count: suppressPackageStartupMessages(library(pkg)).
const DEPENDENCY =
  /^[ \t]*(?:[A-Za-z.][\w.]*[ \t]*\([ \t]*)*(library|require|requireNamespace|source)\s*\(/gm;
// Qualified calls keep their qualifier whole: pkg::fun(x), self$method(x).
const CALL = new RegExp(`((?:${NAME}(?:::|\\$))+${NAME})\\s*\\(|(${NAME})\\s*\\(`, "g");
// Keywords are syntax, and the dependency forms are recorded as imports.
const CALL_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "repeat",
  "function",
  "return",
  "switch",
  "in",
  "next",
  "break",
  "library",
  "require",
  "requireNamespace",
  "source",
]);

// Base mega-hubs: the apply family, data constructors, coercion, plumbing.
// Native-reader-only warding (ast-grep languages are unaffected); single-
// letter helpers (c(), t(), I()) fall below the minimum callee length instead.
const R_BASE_HUBS = new Set([
  // native-reader-internal since the ward split
  "sapply",
  "lapply",
  "vapply",
  "apply",
  "tapply",
  "mapply",
  "eapply",
  "rapply",
  "data.frame",
  "as.data.frame",
  "matrix",
  "as.matrix",
  "as.list",
  "as.vector",
  "as.numeric",
  "as.character",
  "as.integer",
  "as.logical",
  "as.factor",
  "as.date",
  "cbind",
  "rbind",
  "unlist",
  "list",
  "seq",
  "seq_len",
  "seq_along",
  "rep",
  "rev",
  "paste",
  "paste0",
  "cat",
  "message",
  "warning",
  "stop",
  "nrow",
  "ncol",
  "length",
  "names",
  "dim",
  "rownames",
  "colnames",
  "levels",
  "factor",
  "ordered",
  "is.na",
  "na.omit",
  "which",
  "unique",
  "duplicated",
  "order",
  "subset",
  "aggregate",
  "do.call",
  "sort",
  "split",
  "table",
  "head",
  "tail",
  "grep",
  "grepl",
  "sub",
  "gsub",
  "strsplit",
  "nchar",
  "toupper",
  "tolower",
  "mean",
  "median",
  "var",
  "sd",
  "sum",
  "abs",
  "round",
  "sqrt",
  "exp",
  "log",
  "is.null",
  "is.list",
  "is.vector",
  "is.character",
  "is.numeric",
  "is.factor",
  "is.data.frame",
  "class",
  "attr",
  "attributes",
  "structure",
  "print",
  "sprintf",
  "format",
  "suppressmessages",
  "suppresswarnings",
  "suppresspackagemessages",
  // testthat entry points and assertions
  "test_that",
  "expect_equal",
  "expect_true",
  "expect_false",
  "expect_error",
  "expect_warning",
  "expect_identical",
  "expect_named",
  "expect_length",
  "expect_type",
  "expect_match",
  "expect_null",
  "expect_silent",
  "expect_no_error",
  "expect_no_warning",
  "skip_if_not",
  "skip_if_not_installed",
]);

// Read one complete dependency argument from masked source. Named arguments
// and line breaks are syntax, not package names. Never evaluate expressions;
// source() needs a literal path and character.only needs a literal package.
const firstArg = (
  code: string,
  from: number,
  strings: ReadonlyArray<{ start: number; text: string }>,
  source: boolean,
  closes: ReadonlyMap<number, number>,
): string | undefined => {
  const close = closes.get(from - 1);
  if (close === undefined) return undefined;
  let end = close;
  for (let i = from; i < close; i++) {
    const ch = code[i]!;
    if ("([{".includes(ch)) {
      const nested = closes.get(i);
      if (nested === undefined) return undefined;
      i = nested;
    } else if (ch === ",") {
      end = i;
      break;
    }
  }
  const argument = code.slice(from, end);
  const prefix = new RegExp(`^\\s*${source ? "file" : "package"}\\s*=`).exec(argument)?.[0] ?? "";
  const valueStart = from + prefix.length;
  const rest = code.slice(valueStart, end).trim();
  // Strings are ordered by opening position; binary search keeps large import
  // lists linearithmic rather than scanning every earlier literal per call.
  let lo = 0,
    hi = strings.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (strings[mid]!.start < valueStart) lo = mid + 1;
    else hi = mid;
  }
  const quoted = strings[lo];
  if (!rest && quoted && quoted.start < end) return quoted.text;
  if (source || /\bcharacter\.only\s*=\s*TRUE\b/.test(code.slice(end, close))) return undefined;
  return new RegExp(`^${NAME}$`).test(rest) ? rest : undefined;
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

// Section navigation markers (RStudio/languageserver convention): any hash
// run, a title, then four or more - = # at top level; roxygen `#'` never
// matches.
const SECTION = /^#{1,}\s+(.+?)\s+[-=#]{4,}\s*$/;

export const extractR = (file: string, text: string): RFacts => {
  const facts: RFacts = { symbols: [], imports: [], calls: [], literals: [] };
  // Mirror the pipeline literal dedupe key (file|line|text): a repeated
  // string on one line is one join site, not two.
  const seenLiterals = new Set<string>();
  let depth = 0; // open ( [ { across lines, with strings and comments masked
  const classes: Array<{ name: string; at: number }> = []; // open R6Class blocks
  let pending: { name: string; line: number; sig: string } | undefined; // `name <-` split across lines
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const maskedLines: string[] = [];
  const sourceStrings: Array<{ start: number; text: string }> = [];
  // R string literals may span lines (SQL, glue templates): this quote
  // state persists across the line loop below so string bodies stay masked
  // and bracket counting stays honest; unterminated quotes emit nothing.
  let quote = ""; // open delimiter ("" = closed); survives across lines
  let rawClose = ""; // R 4.0 raw-string close sequence ("" = normal string)
  let value = ""; // string body accumulated across lines
  let start = -1; // column of the opening quote
  let quoteLine = 1; // 1-based line of the opening quote
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at]!;
    const line = at + 1;
    // Mask comments (#, #!, #') and string bodies, preserving offsets.
    // Escapes consume the following character, including an escaped quote.
    const startsInString = quote !== ""; // a string opened on an earlier line owns this line
    let code = "";
    let visible = "";
    const strings: Array<{ start: number; text: string }> = [];
    const closeString = (): void => {
      if (value.length >= 2 && value.length <= 200 && !seenLiterals.has(`${quoteLine}|${value}`)) {
        seenLiterals.add(`${quoteLine}|${value}`);
        facts.literals.push({ file, line: quoteLine, text: value });
      }
      strings.push({ start, text: value });
      sourceStrings.push({ start: lineOffsets[quoteLine - 1]! + start, text: value });
      quote = "";
      rawClose = "";
    };
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (quote) {
        if (rawClose) {
          // Raw strings ignore escapes and close only on the mirrored
          // opener sequence (`)"`, `]--"`, ...).
          if (raw.startsWith(rawClose, i)) {
            for (let k = 0; k < rawClose.length; k++) {
              visible += raw[i + k]!;
              code += " ";
            }
            i += rawClose.length - 1;
            closeString();
          } else {
            visible += ch;
            code += " ";
            value += ch;
          }
        } else {
          visible += ch;
          code += " ";
          if (ch === "\\" && i + 1 < raw.length) {
            const escaped = raw[++i]!;
            value +=
              ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[escaped] ??
              escaped;
            code += " ";
            visible += escaped;
          } else if (ch === quote) {
            closeString();
          } else {
            value += ch;
          }
        }
      } else if (ch === "#") {
        break;
      } else if ((ch === "r" || ch === "R") && (raw[i + 1] === '"' || raw[i + 1] === "'")) {
        // R 4.0 raw string: [rR] quote, dashes, optional ( [ { opener; the
        // close mirrors it. A letter glued to a quote is never valid R
        // otherwise, so this cannot mask real code.
        const rAt = i;
        const q = raw[++i]!;
        let dashes = "";
        while (raw[i + 1] === "-") dashes += raw[++i]!;
        const open = "([{".includes(raw[i + 1] ?? "") ? raw[++i]! : "";
        const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : "";
        quote = q;
        rawClose = close + dashes + q;
        value = "";
        start = rAt;
        quoteLine = line;
        for (let k = rAt; k <= i; k++) {
          visible += raw[k]!;
          code += " ";
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        rawClose = "";
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
    if (quote && at + 1 < lines.length) value += "\n";
    maskedLines.push(code.padEnd(raw.length, " "));
    // Section markers live entirely in comments, so `code` is empty and
    // the shared `decl` helper below never sees them; record them directly.
    // A line that starts inside a string body is string content, not a
    // marker, no matter how it reads.
    const section = SECTION.exec(raw);
    if (section && !startsInString && depth === 0 && classes.length === 0) {
      const sig = raw.trim();
      facts.symbols.push({
        file,
        line,
        name: section[1]!.trim(),
        kind: "section",
        sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig,
        lang: "R",
      });
    }
    if (!code.trim()) continue;
    // A bare `name <-` defers its declaration to the next non-blank line
    // (`f <-\n  function(x) x`); any other line cancels the pending site.
    let r6Name: string | undefined;
    if (pending) {
      const fnLine = /^\s*function\s*\(/.test(visible);
      const r6Line = /^\s*(?:R6::)?R6Class\s*\(/.test(visible);
      if (fnLine || r6Line) {
        const inCls = classes.length > 0 && depth > classes.at(-1)!.at;
        const name = fnLine && inCls ? `${classes.at(-1)!.name}.${pending.name}` : pending.name;
        facts.symbols.push({
          file,
          line: pending.line,
          name,
          kind: fnLine ? (inCls ? "method" : "function") : "class",
          sig: pending.sig,
          lang: "R",
        });
        if (r6Line) r6Name = pending.name;
      }
      pending = undefined;
    }
    const inClass = classes.length > 0 && depth > classes.at(-1)!.at;
    const sig = visible.trim();
    const decl = (name: string, kind: SymbolRec["kind"]): void => {
      facts.symbols.push({
        file,
        line,
        name,
        kind,
        sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig,
        lang: "R",
      });
    };
    const r6 = R6_DEF.exec(visible);
    if (r6) {
      r6Name = unquote(r6[1]!);
      decl(r6Name, "class");
    } else {
      // Top-level assignments define functions; inside an R6Class block the
      // list entries become methods. Other nested forms (argument defaults)
      // are skipped. Declaration forms run against `visible`, where quoted
      // and backtick names survive masking.
      const def = DEF.exec(visible);
      if (def && (depth === 0 || inClass)) {
        const name = unquote(def[1]!);
        decl(inClass ? `${classes.at(-1)!.name}.${name}` : name, inClass ? "method" : "function");
      } else {
        const setClass = SET_CLASS.exec(visible);
        const setGeneric = SET_GENERIC.exec(visible);
        const setMethod = SET_METHOD.exec(visible);
        if (setClass) {
          const name =
            stringArg(visible, strings) ??
            (setClass[1] !== undefined ? unquote(setClass[1]) : undefined);
          if (name) decl(name, "class");
        } else if (setGeneric) {
          const name =
            stringArg(visible, strings) ??
            (setGeneric[1] !== undefined ? unquote(setGeneric[1]) : undefined);
          if (name) decl(name, "function");
        } else if (setMethod) {
          const name =
            stringArg(visible, strings) ??
            (setMethod[1] !== undefined ? unquote(setMethod[1]) : undefined);
          if (name) decl(name, "method");
        } else if (depth === 0) {
          // Non-function top-level assignments are the data surface of an
          // analysis script: theme <- theme_bw(), counts <- read.csv(...).
          // Nested depth (locals, argument defaults) stays invisible.
          // Match against `visible`, not `code`: a string-literal RHS
          // (PREFIX <- "fig_") is masked to spaces in `code`. Right forms
          // (`function(x) x -> f`, `value ->> cap`) bind at line end; a
          // string body cannot forge one because its closing quote trails.
          const assign = ASSIGN.exec(visible);
          const rightFn = RIGHT_FN.exec(visible);
          const rightAssign = RIGHT_ASSIGN.exec(visible);
          const pendingAssign = PENDING_ASSIGN.exec(visible);
          if (assign) decl(unquote(assign[1]!), "decl");
          else if (rightFn) decl(rightFn[1]!, "function");
          else if (rightAssign) decl(rightAssign[2]!, "decl");
          else if (pendingAssign) {
            pending = {
              name: unquote(pendingAssign[1]!),
              line,
              sig: sig.length > 140 ? sig.slice(0, 137) + "..." : sig,
            };
          }
        }
      }
    }
    CALL.lastIndex = 0;
    for (const call of code.matchAll(CALL)) {
      const name = call[1] ?? call[2]!;
      if (name.length <= 1 || CALL_KEYWORDS.has(name) || R_BASE_HUBS.has(name.toLowerCase()))
        continue;
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
    // Only a header that leaves a bracket open scopes members. A single-line
    // R6Class("Base") closes itself: pushing it anyway would swallow the next
    // # section and poison inClass for the next function body.
    if (r6Name !== undefined && net > 0) classes.push({ name: r6Name, at: depthBefore });
  }
  const maskedSource = maskedLines.join("\n");
  // Pair delimiters once: malformed/nested calls must not trigger a full
  // suffix scan for every library() site in a large source file.
  const closes = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < maskedSource.length; i++) {
    const ch = maskedSource[i]!;
    if ("([{".includes(ch)) stack.push(i);
    else if (")]}".includes(ch)) {
      const open = stack.pop();
      if (open !== undefined && "([{".indexOf(maskedSource[open]!) === ")]}".indexOf(ch))
        closes.set(open, i);
      else stack.length = 0;
    }
  }
  DEPENDENCY.lastIndex = 0;
  let dependencyLine = 0;
  for (const match of maskedSource.matchAll(DEPENDENCY)) {
    const source = match[1] === "source";
    const spec = firstArg(
      maskedSource,
      match.index! + match[0].length,
      sourceStrings,
      source,
      closes,
    );
    if (spec === undefined) continue;
    while (
      dependencyLine + 1 < lineOffsets.length &&
      lineOffsets[dependencyLine + 1]! <= match.index!
    )
      dependencyLine++;
    facts.imports.push({
      file,
      line: dependencyLine + 1,
      spec,
      form: source ? "r-source" : "r-package",
    });
  }
  // A generic and its setMethod implementations share a graph identity;
  // likewise a re-assigned name keeps one symbol. First site wins.
  const symbols = new Map<string, SymbolRec>();
  const symbolKey = (symbol: SymbolRec): string =>
    symbol.kind === "section" ? `section:${symbol.name}` : symbol.name;
  for (const symbol of facts.symbols)
    if (!symbols.has(symbolKey(symbol))) symbols.set(symbolKey(symbol), symbol);
  facts.symbols = [...symbols.values()].sort((a, b) => a.line - b.line);
  return facts;
};
