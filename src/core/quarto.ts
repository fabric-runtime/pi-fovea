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
const CHUNK_OPEN = /^```+\s*\{\s*(r|python)\b\s*([^}]*)\}/;
// The chunk label is the first option token when it is a bare word: an
// identifier followed by a comma or end-of-options (`echo=FALSE` never wins).
const CHUNK_LABEL = /^([A-Za-z0-9_.+-]+)\s*(?:,|$)/;
const FENCE_CLOSE = /^```+\s*$/
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
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at]!;
    if (engine) {
      if (FENCE_CLOSE.test(raw)) {
        flush();
        continue;
      }
      body.push(raw);
      continue;
    }
    const open = CHUNK_OPEN.exec(raw);
    if (open) {
      engine = open[1] as "r" | "python";
      label = CHUNK_LABEL.exec(open[2] ?? "")?.[1];
      offset = at + 1;
    }
  }
  flush(); // an unterminated final chunk still counts
  return facts;
};
