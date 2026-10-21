// Quarto/knitr notebook reader: {r}/{python} fenced chunks become
// first-class facts. R chunk bodies reuse the native R reader (symbols,
// library()/source() imports, calls, literals) at absolute line numbers;
// python chunks record imports only — symbols there would need a grammar,
// which native readers exist to avoid. Markdown prose and other engines
// are ignored, and chunk ordinals number only the indexed chunks.

import { extractR } from "./r.js";
import type { CallSite, ImportSite, LiteralSite, SymbolRec } from "./types.js";

export type QuartoFacts = {
  symbols: SymbolRec[];
  imports: ImportSite[];
  calls: CallSite[];
  literals: LiteralSite[];
};

// ```{r label, opts} / ```{python label} — engine word, then options.
// `{.r}` dot-syntax cells are a Quarto variant left outside this reader.
const CHUNK_OPEN = /^(`{3,})\s*\{\s*(r|python)\b\s*([^}]*)\}/;
// The chunk label is the first option token when it is a bare word: an
// identifier followed by a comma or end-of-options (`echo=FALSE` never wins).
const CHUNK_LABEL = /^([A-Za-z0-9_.+-]+)\s*(?:,|$)/;
// A close fence needs a backtick run at least as long as the opener's;
// up to three leading spaces are legal fence indentation (CommonMark).
const FENCE_CLOSE = /^ {0,3}(`{3,})\s*$/
// Python imports: the one cheap, low-noise fact for non-R chunks.
const PY_IMPORT = /^\s*(?:from\s+([A-Za-z_][\w.]*)|import\s+([A-Za-z_][\w.]*))/;

export const extractQuarto = (file: string, text: string): QuartoFacts => {
  const facts: QuartoFacts = { symbols: [], imports: [], calls: [], literals: [] };
  const lines = text.split("\n");
  let engine: "r" | "python" | undefined;
  let label: string | undefined; // knitr chunk label: ```{r setup, ...}
  let offset = 0; // 0-based line index of the first body line
  let body: string[] = [];
  let chunk = 0; // ordinal across indexed ({r}/{python}) chunks only
  const flush = (): void => {
    if (engine && body.length) {
      chunk += 1;
      if (engine === "r") {
        const inner = extractR(file, body.join("\n"));
        for (const s of inner.symbols) facts.symbols.push({ ...s, line: s.line + offset, chunk, chunkLabel: label });
        for (const i of inner.imports) facts.imports.push({ ...i, line: i.line + offset });
        for (const c of inner.calls) facts.calls.push({ ...c, line: c.line + offset });
        for (const l of inner.literals) facts.literals.push({ ...l, line: l.line + offset });
      } else {
        for (let i = 0; i < body.length; i++) {
          const py = PY_IMPORT.exec(body[i]!);
          if (py) facts.imports.push({ file, line: i + 1 + offset, spec: (py[1] ?? py[2])! });
        }
      }
    }
    engine = undefined;
    body = [];
  };
  let fenceLen = 0; // backticks in the current chunk opener
  let skipFence = 0; // a non-target fence block being skipped (markdown examples)
  let skipChar = "`"; // fences close with the character that opened them
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at]!;
    const fence = FENCE_CLOSE.exec(raw);
    if (engine) {
      // A chunk closes only at a fence at least as long as its opener:
      // a shorter run inside the body is content, not a terminator.
      if (fence && fence[1]!.length >= fenceLen) {
        flush();
        continue;
      }
      body.push(raw);
      continue;
    }
    if (skipFence) {
      const close = skipChar === "`" ? fence?.[1] : /^ {0,3}(~{3,})\s*$/.exec(raw)?.[1];
      if (close && close.length >= skipFence) skipFence = 0;
      continue;
    }
    const open = CHUNK_OPEN.exec(raw);
    if (open) {
      fenceLen = open[1]!.length;
      engine = open[2] as "r" | "python";
      label = CHUNK_LABEL.exec(open[3] ?? "")?.[1];
      offset = at + 1;
      continue;
    }
    // Any other fence-like opener ({bash}, {.r}, a bare run) starts a
    // non-target block - often a markdown example displaying a literal
    // chunk header; skip to its matching close.
    // Tilde fences count too: a ~~~ example can display a literal ```{r}
    // header without it being indexed as a real chunk.
    const otherFence = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (otherFence) {
      skipFence = otherFence[1]!.length;
      skipChar = otherFence[1]![0]!;
    }
  }
  flush(); // an unterminated final chunk still counts
  return facts;
};
