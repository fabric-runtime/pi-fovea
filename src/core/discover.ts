// Tier-3: autonomy for route extraction. The static pack catches known port
// shapes; this module watches the literal channel for shapes the pack does NOT
// declare, promotes statistically significant ones into synthesized "implicit"
// rules at half hub gravity, and lets confirmatory joins against real hubs
// upgrade them to full first-class weight.
//
// The promotion statistic is a per-argument conditional: given the string arg
// at position i of call-shape (lang·shape·callee), how often does it classify
// as a path? A Jeffreys-smoothed posterior with global floors decides — not raw
// frequency, under which chaff like `assertEquals(...)` dwarfs every real shape.
//
// Corpus audit (8 repos, 183 sigs n≥4): junk bands sit below p̂≈0.27, real
// shapes above p̂≈0.75 — the 0.55 line is a cliff, not a gradient.
//
// Harvest is line-regex over source text — no ast-grep pass needed. Per file we
// store a compact signature histogram (sig -> [sites, pathSites]); promotions
// aggregate across ALL files of the repo, so a dependency update or a style
// drift can only flip a marginal signature when its repo-wide evidence moves.

import { compileMethods } from "./anchors.js";
import { classifyLiteral } from "./join.js";

type Shape = "recv" | "bare" | "dec";

// Compacted per-file histogram: sigKey -> [totalSites, pathSites]
export type FileSigs = Record<string, [number, number]>;

// Line-local call scan: grabs the callee shape (recv chain, bare, decorator)
// and the raw arg list of every `X(...)` on the line. Multi-line calls still
// land because route strings overwhelmingly sit on the call's first line.
const CALL_LINE_RE =
  /(?<at>@)?(?<recv>(?:[A-Za-z_$][\w$]*\.)+)?(?<method>[A-Za-z_$][\w$]*)\s*\((?<args>[^()]*)\)/g;
const STRING_RE = /([rbfuRBFU]{0,3})(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;

// Callees that are noise even at 100% precision (env/fs access, string ctors,
// module loading — dynamic import()/require() hits the path channel but the
// import edge already covers it, an anchor would double-count the site).
const CALLEE_DENY = new Set([
  "join",
  "resolve",
  "dirname",
  "basename",
  "expand_path",
  "readFile",
  "readFileSync",
  "existsSync",
  "open",
  "load",
  "loads",
  "import",
  "require",
  // String predicates: membership tests hit the path column at high rate but
  // never refer to routes. (Distinguishing cause from noise is callee-semantic.)
  "startsWith",
  "endsWith",
  "contains",
  "includes",
  "equals",
  "equalsIgnoreCase",
  "matches",
  "matchesPattern",
  "useParams",
  "matchPath",
]);

export const harvestFile = (lang: string, text: string): FileSigs => {
  const sigs: FileSigs = {};
  for (const line of text.split("\n")) {
    if (!line.includes("(") || !(line.includes('"') || line.includes("'") || line.includes("`")))
      continue;
    CALL_LINE_RE.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CALL_LINE_RE.exec(line))) {
      const method = c.groups?.method;
      if (!method || CALLEE_DENY.has(method)) continue;
      const shape: Shape = c.groups?.at ? "dec" : c.groups?.recv ? "recv" : "bare";
      const argsText = c.groups?.args ?? "";
      if (!argsText) continue;
      // True argument index of each string literal (split tolerantly on commas).
      const args = argsText.split(",");
      let idx = 0;
      for (const raw of args) {
        STRING_RE.lastIndex = 0;
        const sm = STRING_RE.exec(raw);
        const idxNow = idx++;
        if (!sm) continue;
        const lit = sm[3];
        if (lit === undefined || lit === "") continue;
        const key = `${lang}|${shape}|${method}|${idxNow}`;
        const rec = sigs[key] ?? [0, 0];
        rec[0]++;
        if (classifyLiteral(lit) === "path") rec[1]++;
        sigs[key] = rec;
      }
    }
  }
  return sigs;
};

export interface SigStats {
  key: string;
  lang: string;
  shape: Shape;
  callee: string;
  argIdx: number;
  n: number;
  pathN: number;
  files: number;
}

export const aggregateFiles = (perFile: Record<string, FileSigs | undefined>): SigStats[] => {
  const agg = new Map<string, SigStats>();
  for (const sigs of Object.values(perFile)) {
    if (!sigs) continue;
    for (const [key, [n, p]] of Object.entries(sigs)) {
      const stat = agg.get(key);
      if (stat) {
        stat.n += n;
        stat.pathN += p;
        stat.files++;
      } else {
        const [lang, shape, callee, argIdx] = key.split("|");
        agg.set(key, {
          key,
          lang: lang!,
          shape: shape as Shape,
          callee: callee!,
          argIdx: Number(argIdx),
          n,
          pathN: p,
          files: 1,
        });
      }
    }
  }
  return [...agg.values()];
};

/** Jeffreys-ish posterior: p̂ = (pathN + .5) / (n + 1). */
export const posterior = (pathN: number, n: number): number => (pathN + 0.5) / (n + 1);

const MIN_SITES = 4;
const MIN_FILES = 2;
const MIN_POSTERIOR = 0.55;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Pattern synthesis per shape and arg position: dummy metavars for the slots
// the corpus says are not the path, $P at the proven position. Two variants
// per site — exact arity and with a trailing $$$H absorb — because some
// dialects only match with explicit tail holes (Python `$X, $P, $$$H`).
export interface SynthesizedRule {
  id: string;
  langs: string[];
  patterns: string[]; // patternRunAll variants
  methods: string;
  kind: string;
  implicit: true;
  evidence: { n: number; pathN: number; files: number; posterior: number };
}

export const synthesize = (s: SigStats): SynthesizedRule | undefined => {
  const slots: string[] = [];
  for (let i = 0; i <= s.argIdx; i++) slots.push(i === s.argIdx ? "$P" : `$X${i}`);
  const inner = slots.join(", ");
  let variants: string[];
  switch (s.shape) {
    case "recv":
      variants = [`$R.$M(${inner})`, `$R.$M(${inner}, $$$H)`];
      break;
    case "bare":
      variants = [`$M(${inner})`, `$M(${inner}, $$$H)`];
      break;
    case "dec":
      variants = [`@$M(${inner})`, `@$M(${inner}, $$$H)`];
      break;
  }
  return {
    id: `implicit:${s.lang.toLowerCase()}:${s.shape}:${s.callee}:${s.argIdx}`,
    langs: [s.lang],
    patterns: variants,
    methods: `^(?i:${escapeRe(s.callee)})$`,
    kind: "route",
    implicit: true,
    evidence: { n: s.n, pathN: s.pathN, files: s.files, posterior: posterior(s.pathN, s.n) },
  };
};

// Shape-shape compatibility: a discovery is only NEW when no existing rule
// already binds the callee with a compatible pattern shape in that language.
// e.g. Java's @GetMapping is in the pack, so java:dec:GetMapping promotes nothing.
const shapeCompatPatterns: Record<Shape, RegExp> = {
  recv: /^\$R\.\$M\(/,
  bare: /^\$M[(\s]/,
  dec: /^@\$(R\.)?M\(/,
};

const isCovered = (
  sig: SigStats,
  pack: Array<{ langs: string[]; methods: string; pattern?: string; patterns?: string[] }>,
): boolean => {
  const mre = (methods: string, callee: string): boolean => compileMethods(methods).test(callee);
  return pack.some((r) => {
    if (!r.langs.includes(sig.lang)) return false;
    if (!mre(r.methods, sig.callee)) return false;
    const pats = r.patterns ?? (r.pattern ? [r.pattern] : []);
    return pats.some((p) => shapeCompatPatterns[sig.shape].test(p));
  });
};

export const promote = (
  sigs: SigStats[],
  pack: Array<{
    id: string;
    langs: string[];
    methods: string;
    pattern?: string;
    patterns?: string[];
  }> = [],
): SynthesizedRule[] => {
  const out: SynthesizedRule[] = [];
  for (const s of sigs) {
    if (s.n < MIN_SITES || s.files < MIN_FILES) continue;
    if (posterior(s.pathN, s.n) < MIN_POSTERIOR) continue;
    if (isCovered(s, pack)) continue;
    const r = synthesize(s);
    if (r) out.push(r);
  }
  return out;
};
