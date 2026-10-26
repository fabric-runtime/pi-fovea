import { readFileSync, statSync } from "node:fs";
import { basename, posix } from "node:path";
import { forEachChunked } from "./asyncutil.js";
import { LANG_BY_EXT } from "./astgrep.js";
import { isTestFile, supportsImportExtraction } from "./extract.js";
import { buildJoinIndex, type JoinIndex } from "./join.js";
import type { AnchorDraft } from "./anchors.js";
import type { FileFacts } from "./build.js";
import type { Edge, EdgeEvidence, Graph, ImportCoverage, ImportSite, LiteralSite, NodeRec } from "./types.js";

const CODE_EXTS_BY_LANGFAMILY: Record<string, string[]> = {
  ts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  py: [".py"],
  rs: [".rs"],
  go: [],
};

const langFamily = (file: string): string => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) return "ts";
  if (ext === "py") return "py";
  if (ext === "rs") return "rs";
  if (ext === "go") return "go";
  return ext;
};

// Base R packages ship with the interpreter; using one without a
// DESCRIPTION entry is not a missing dependency.
const R_BASE_PACKAGES = new Set([
  "base", "compiler", "datasets", "grdevices", "graphics", "grid", "methods",
  "parallel", "splines", "stats", "stats4", "tcltk", "tools", "utils",
]);

// pkg:: qualified calls name their package before the ::.
const PKG_QUALIFIER = /^([A-Za-z][\w.]*)::/;

// DESCRIPTION is repository-controlled metadata: admit it like source
// files (regular file, bounded bytes) and scan continuation lines by index
// so repeated dependency headers cannot force quadratic suffix copies.
// Continuation lines (indented) belong to the previous key; entries may
// carry version constraints (`dplyr (>= 1.0)`) — the bare name joins.
const MAX_DESCRIPTION_BYTES = 256 * 1024;
const declaredPackages = (root: string): Set<string> | undefined => {
  const path = posix.join(root, "DESCRIPTION");
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_DESCRIPTION_BYTES) return undefined;
  } catch {
    return undefined;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const rows = text.split("\n");
  const declared = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const head = /^(Imports|Depends|Suggests|LinkingTo):/i.exec(rows[i]!);
    if (!head) continue;
    const parts = [rows[i]!.slice(head[0].length)];
    for (let j = i + 1; j < rows.length && /^\s+\S/.test(rows[j]!); j++) parts.push(rows[j]!.trim());
    for (const entry of parts.join(",").split(",")) {
      const name = entry.replace(/\(.*\)/, "").trim();
      if (name && name !== "R") declared.add(name);
    }
  }
  return declared;
};

/**
 * Precomputed suffix indexes. The naive resolvers scanned the whole file set
 * per import (O(imports × files)), which quadratic-blows on big trees; these
 * maps make each lookup near-constant while preserving the exact match rules.
 */
interface ImportIndex {
  fileSet: Set<string>;
  filesByDir: Map<string, string[]>;
  /** Go: last-k-segment dir suffix (k <= 3) -> dirs, built for every source dir. */
  goDirsBySuffix: Map<string, string[]>;
  /** Rust: module basename -> files (`foo.rs`, `foo/mod.rs`). */
  rsByBase: Map<string, string[]>;
  /** TS bare specifiers: last path segment -> `x.ts` / `x/index.ts` files. */
  tsByTailStem: Map<string, string[]>;
}

const pushIndex = (m: Map<string, string[]>, key: string, value: string): void => {
  (m.get(key) ?? m.set(key, []).get(key)!).push(value);
};

const buildImportIndex = (files: string[]): ImportIndex => {
  const fileSet = new Set(files);
  const filesByDir = new Map<string, string[]>();
  const goDirsBySuffix = new Map<string, string[]>();
  const rsByBase = new Map<string, string[]>();
  const tsByTailStem = new Map<string, string[]>();
  for (const f of files) {
    const dir = posix.dirname(f);
    pushIndex(filesByDir, dir, f);
  }
  for (const dir of filesByDir.keys()) {
    const segs = dir.split("/").filter(Boolean);
    for (let k = 1; k <= Math.min(3, segs.length); k++) {
      pushIndex(goDirsBySuffix, segs.slice(-k).join("/"), dir);
    }
  }
  for (const f of files) {
    if (f.endsWith(".rs")) {
      const base = basename(f, ".rs");
      pushIndex(rsByBase, base, f);
      if (base === "mod") {
        const parentBase = basename(posix.dirname(f));
        pushIndex(rsByBase, parentBase, f);
      }
    }
    if (f.endsWith(".ts")) {
      const base = basename(f, ".ts");
      if (base === "index") pushIndex(tsByTailStem, basename(posix.dirname(f)), f);
      else pushIndex(tsByTailStem, base, f);
    }
  }
  return { fileSet, filesByDir, goDirsBySuffix, rsByBase, tsByTailStem };
};

interface ImportResolution {
  file: string;
  alias?: string;
  evidence: EdgeEvidence;
}

const resolveImportToFile = (
  spec: string,
  fromFile: string,
  index: ImportIndex,
): ImportResolution | undefined => {
  const { fileSet } = index;
  const fam = langFamily(fromFile);
  const exact = (candidates: string[], strategy: EdgeEvidence["strategy"]): ImportResolution | undefined => {
    const hits = [...new Set(candidates)].filter((candidate) => fileSet.has(candidate));
    return hits.length
      ? { file: hits[0]!, evidence: { strategy, rule: "import-resolve", source: spec, candidates: hits.length } }
      : undefined;
  };
  if (fam === "bend") {
    // Base is bundled by the compiler; hub packages are external. Neither
    // should accidentally resolve via the TypeScript bare-specifier fallback.
    if (spec === "Base" || /^0x[0-9a-f]+\//i.test(spec) || posix.isAbsolute(spec)) return undefined;
    const local = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    if (local === ".." || local.startsWith("../")) return undefined;
    return exact([local], "relative-import");
  }
  if (fam === "r" || fam === "qmd" || fam === "rmd") {
    // library(pkg) names an installed package and stays unresolved by
    // design; source("file.R") includes are relative to the importing script.
    // Notebooks share the rule: python chunk imports (bare specs like
    // `utils`) must never reach the TypeScript bare-specifier fallback.
    if (!/\.r$/i.test(spec) || posix.isAbsolute(spec)) return undefined;
    const local = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    if (local === ".." || local.startsWith("../")) return undefined;
    return exact([local], "relative-import");
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    let base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    // NodeNext convention: TS files import "./sibling.js" — the .js refers to
    // the .ts source. Strip a runtime extension before probing.
    base = base.replace(/\.(?:[cm]?js|jsx)$/, "");
    const candidates: string[] = [];
    for (const ext of CODE_EXTS_BY_LANGFAMILY[fam] ?? []) {
      candidates.push(base + ext, `${base}/index${ext}`);
    }
    candidates.push(base);
    return exact(candidates, "relative-import");
  }
  if (fam === "py") {
    const p = spec.replace(/\./g, "/");
    return exact([`${p}.py`, `${p}/__init__.py`], "python-module");
  }
  if (fam === "go") {
    const segs = spec.split("/").filter(Boolean);
    for (let k = 1; k <= Math.min(3, segs.length); k++) {
      const suffix = segs.slice(-k).join("/");
      const matches = (index.goDirsBySuffix.get(suffix) ?? []).filter(
        (directory) => directory === suffix || directory.endsWith(`/${suffix}`),
      );
      if (matches.length === 1) {
        const inDir = index.filesByDir.get(matches[0]!) ?? [];
        if (inDir.length) {
          return {
            file: inDir[0]!,
            evidence: { strategy: "go-module-suffix", rule: "go-package-representative", source: spec, candidates: inDir.length },
          };
        }
      }
    }
    return undefined;
  }
  if (fam === "rs") {
    const modPath = spec.replace(/^crate::|^self::/, "").replace(/::/g, "/");
    const direct = exact([`src/${modPath}.rs`, `${modPath}.rs`], "rust-module");
    if (direct) return direct;
    const baseName = basename(modPath);
    const hits = (index.rsByBase.get(baseName) ?? []).filter(
      (file) => file === `${baseName}.rs` || file.endsWith(`/${baseName}.rs`) || file.endsWith(`/${baseName}/mod.rs`),
    );
    return hits.length === 1
      ? { file: hits[0]!, evidence: { strategy: "rust-module", rule: "import-resolve", source: spec, candidates: hits.length } }
      : undefined;
  }
  // TS bare specifier: node_modules or aliased; try a tail match.
  const tail = spec.split("/").filter(Boolean).join("/");
  const stem = tail.split("/").pop() ?? tail;
  const hits = (index.tsByTailStem.get(stem) ?? []).filter(
    (file) => file.endsWith(`/${tail}.ts`) || file.endsWith(`/${tail}/index.ts`),
  );
  return hits.length === 1
    ? { file: hits[0]!, evidence: { strategy: "typescript-tail", rule: "import-resolve", source: spec, candidates: hits.length } }
    : undefined;
};

interface ImportFamily { files: string[]; reason?: string; capped?: boolean }

// Resolve only an in-scope literal path family, not arbitrary runtime values.
// Refuse broad families rather than emitting an unexplained partial target set.
const importFamilyResolver = (files: string[]) => {
  const sorted = [...files].sort();
  const cache = new Map<string, ImportFamily>();
  return (site: ImportSite): ImportFamily => {
    const bounds = site.dynamic;
    if (langFamily(site.file) !== "ts" || bounds?.prefix === undefined || bounds.suffix === undefined ||
      (!bounds.prefix.startsWith("./") && !bounds.prefix.startsWith("../"))) {
      return { files: [], reason: "computed target is not a bounded relative literal-prefix/suffix expression" };
    }
    const joined = posix.join(posix.dirname(site.file), bounds.prefix);
    const prefix = joined === "." || joined === "./" ? "" : joined;
    if (prefix === ".." || prefix.startsWith("../") || posix.isAbsolute(prefix)) {
      return { files: [], reason: "computed family lies outside the selected root" };
    }
    const key = JSON.stringify([prefix, bounds.suffix]);
    const cached = cache.get(key);
    if (cached) return cached;
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < prefix) lo = mid + 1; else hi = mid;
    }
    const hits: string[] = [];
    let examined = 0;
    for (let at = lo; at < sorted.length && sorted[at]!.startsWith(prefix); at++) {
      if (++examined > 4096) {
        const result = { files: [], capped: true, reason: "computed family scan exceeded 4096 files; no possible edges emitted" };
        cache.set(key, result);
        return result;
      }
      const file = sorted[at]!;
      const runtime = file.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
      if (!file.endsWith(bounds.suffix) && !runtime.endsWith(bounds.suffix)) continue;
      hits.push(file);
      if (hits.length > 32) {
        const result = { files: [], capped: true, reason: "computed family exceeds 32 possible targets; no possible edges emitted" };
        cache.set(key, result);
        return result;
      }
    }
    const result = hits.length ? { files: hits } : { files: [], reason: "no matching targets in the selected graph" };
    cache.set(key, result);
    return result;
  };
};

const addNode = (nodes: NodeRec[], seen: Map<string, number>, rec: NodeRec): number => {
  const hit = seen.get(rec.id);
  if (hit !== undefined) return hit;
  const idx = nodes.length;
  seen.set(rec.id, idx);
  nodes.push(rec);
  return idx;
};

export interface GraphAssembly { graph: Graph; joinIndex: JoinIndex }

export const assembleGraphWithIndex = async (
  root: string,
  files: string[],
  factsMap: Map<string, FileFacts> | Record<string, FileFacts>,
): Promise<GraphAssembly> => {
  const facts = (file: string): FileFacts | undefined =>
    factsMap instanceof Map ? factsMap.get(file) : factsMap[file];
  const factValues = (): Iterable<FileFacts> =>
    factsMap instanceof Map ? factsMap.values() : Object.values(factsMap);
  const nodes: NodeRec[] = [];
  const seen = new Map<string, number>();
  const edges: Edge[] = [];
  const byFile = new Map<string, number[]>();
  const fileIdx = new Map<string, number>();

  const pushEdge = (a: number, b: number, kind: Edge["kind"], w: number, evidence: EdgeEvidence): void => {
    if (a === b) return;
    edges.push({ a, b, kind, w, evidence });
  };

  // File nodes first (stable for enclosing fallback + sketch grouping).
  for (const rel of files) {
    const idx = addNode(nodes, seen, {
      id: `file:${rel}`, name: posix.basename(rel), kind: "file", file: rel, line: 0,
      sig: rel, lang: LANG_BY_EXT[rel.split(".").pop()?.toLowerCase() ?? ""] ?? "config",
    });
    fileIdx.set(rel, idx);
    (byFile.get(rel) ?? byFile.set(rel, []).get(rel)!).push(idx);
  }

  // Symbol nodes + contains edges.
  const symIdxByFileLine = new Map<string, number>(); // `${file}:${line}` first symbol idx
  await forEachChunked(files, 512, (rel) => {
    const f = facts(rel);
    if (!f) return;
    for (const s of f.symbols) {
      // Sections keep a distinct identity: `# Fit ----` and Fit <- function
      // are two symbols that happen to share a name. Quarto symbols keep
      // their chunk identity: same-named definitions in different chunks of
      // one notebook stay distinct nodes instead of first-wins.
      const idx = addNode(nodes, seen, { id: s.kind === "section" ? `section:${s.name}@${s.file}` : `${s.name}@${s.file}${s.chunk == null ? "" : `@chunk:${s.chunk}`}`, ...s });
      (byFile.get(rel) ?? byFile.set(rel, []).get(rel)!).push(idx);
      pushEdge(fileIdx.get(rel)!, idx, "contains", 1.0, { strategy: "file-membership", rule: "symbol-contained-by-file", source: rel });
      const key = `${rel}:${s.line}`;
      if (!symIdxByFileLine.has(key)) symIdxByFileLine.set(key, idx);
    }
  });

  // Order each file's node list by line for enclosing-symbol queries.
  for (const [, arr] of byFile) arr.sort((x, y) => nodes[x]!.line - nodes[y]!.line);

  const enclosingIdx = (file: string, line: number): number => {
    const arr = byFile.get(file) ?? [];
    let best = fileIdx.get(file)!;
    for (const idx of arr) {
      const n = nodes[idx]!;
      if (n.kind !== "file" && n.line <= line && nodes[best]!.line <= n.line) best = idx;
    }
    return best;
  };

  // byName index: exact, lowercased, and short suffix (methods).
  const byName = new Map<string, number[]>();
  {
    const addKey = (key: string, idx: number): void => {
      if (!key) return;
      (byName.get(key) ?? byName.set(key, []).get(key)!).push(idx);
    };
    nodes.forEach((n, i) => {
      if (n.kind === "file" || n.kind === "anchor" || n.kind === "package") return;
      addKey(n.name.toLowerCase(), i);
      const dot = n.name.indexOf(".");
      if (dot > 0) addKey(n.name.slice(dot + 1).toLowerCase(), i);
    });
  }

  const importIndex = buildImportIndex(files);
  const resolveFamily = importFamilyResolver(files);
  const importCoverage: ImportCoverage = {
    sites: 0, resolved: 0, possible: 0, unresolved: 0, capped: 0,
    unsupportedLanguages: [...new Set(files.map((file) => LANG_BY_EXT[file.split(".").pop()?.toLowerCase() ?? ""])
      .filter((language): language is string => !!language && !supportsImportExtraction(language)))].sort(),
    examples: [], examplesOmitted: 0,
  };
  const noteImport = (site: ImportSite, status: ImportCoverage["examples"][number]["status"], reason: string): void => {
    if (importCoverage.examples.length < 20) {
      importCoverage.examples.push({ file: site.file, line: site.line, spec: site.spec.slice(0, 160), status, reason });
    } else importCoverage.examplesOmitted++;
  };

  // External R package usage joins as pkg:x nodes: library()/require()/
  // requireNamespace() sites plus pkg:: qualified calls, one node per package.
  type PackageOrigin = "r" | "python";
  type PackageAgg = { name: string; files: Set<string>; origins: Set<PackageOrigin> };
  const pkgSites = new Map<string, PackageAgg>();
  const pkgQuals = new Map<string, PackageAgg>();
  const notePkgSite = (map: Map<string, PackageAgg>, name: string, file: string, origin: PackageOrigin = "r"): void => {
    const agg = map.get(name.toLowerCase()) ?? { name, files: new Set<string>(), origins: new Set<PackageOrigin>() };
    agg.files.add(file);
    agg.origins.add(origin);
    map.set(name.toLowerCase(), agg);
  };
  // Import edges (file-level, low conductance backbone) + tests wiring.
  const importTargets = new Map<string, ImportResolution[]>();
  await forEachChunked(files, 512, (rel) => {
    const f = facts(rel);
    if (!f) return;
    for (const imp of f.imports) {
      importCoverage.sites++;
      if (imp.dynamic) {
        const family = resolveFamily(imp);
        if (!family.files.length) {
          importCoverage.unresolved++;
          if (family.capped) importCoverage.capped++;
          noteImport(imp, family.capped ? "capped" : "unresolved", family.reason!);
          continue;
        }
        importCoverage.possible++;
        noteImport(imp, "possible", `${family.files.length} literal-prefix/suffix targets; runtime values are not evaluated`);
        for (const file of family.files) {
          pushEdge(fileIdx.get(rel)!, fileIdx.get(file)!, "imports", 0.15 / family.files.length, {
            strategy: "computed-import-family", rule: "literal-prefix-suffix", source: imp.spec,
            candidates: family.files.length, possible: true,
          });
        }
        // Possible targets must not become exact call-resolution or test edges.
        continue;
      }
      const target = resolveImportToFile(imp.spec, rel, importIndex);
      if (!target) {
        importCoverage.unresolved++;
        // R-family package imports (library()/require()/requireNamespace() in
        // scripts, bare module imports in notebook python chunks) join the
        // graph as pkg:x external nodes: installed packages are dependencies
        // even though nothing in this tree resolves them.
        // File-like specs (helpers.R, data.csv) are never packages. Reject
        // known R-ecosystem file extensions, not any short dotted suffix:
        // data.tree is a real CRAN package and must survive.
        const R_FILE_EXT = /\.(?:R|r|Rmd|rmd|Rnw|rnw|qmd|csv|tsv|txt|json|ya?ml|toml|rds|rda|RData|Rproj|so|dll|png|jpe?g|gif|svg|pdf|html|css|js|mjs|ts|tsx|py|sh|bash|md)$/i;
        if (["r", "qmd", "rmd"].includes(langFamily(rel)) && /^[A-Za-z][\w.]*$/.test(imp.spec) && !R_FILE_EXT.test(imp.spec)) {
          notePkgSite(pkgSites, imp.spec, rel, imp.origin ?? "r");
        }
        noteImport(imp, "unresolved", "not resolved within the selected graph; may be external or outside the modeled import forms");
        continue;
      }
      importCoverage.resolved++;
      if (target.file === rel) continue;
      pushEdge(fileIdx.get(rel)!, fileIdx.get(target.file)!, "imports", 0.3, target.evidence);
      (importTargets.get(rel) ?? importTargets.set(rel, []).get(rel)!).push({ ...target, alias: imp.alias });
    }
    if (isTestFile(rel)) {
      const wired = new Set<string>();
      for (const target of importTargets.get(rel) ?? []) {
        wired.add(target.file);
        pushEdge(fileIdx.get(rel)!, fileIdx.get(target.file)!, "tests", 0.6, {
          strategy: "test-import",
          rule: "test-subject-import",
          source: target.evidence.source,
          candidates: target.evidence.candidates,
        });
      }
      // Naming-convention fallback (testthat): tests/testthat/test-x.R pairs
      // with R/x.R even when no source() import links them. R/ wins over
      // same-stem files elsewhere in the tree.
      if (langFamily(rel) === "r") {
        const stem = posix.basename(rel).replace(/^test[-_]/i, "").replace(/\.[rR]$/, "");
        const stemOf = (f: string): string => posix.basename(f).replace(/\.[rR]$/, "");
        const subject = files.find((f) => f !== rel && /^R\//.test(f) && stemOf(f) === stem)
          ?? files.find((f) => f !== rel && !isTestFile(f) && langFamily(f) === "r" && stemOf(f) === stem);
        if (subject && !wired.has(subject)) {
          pushEdge(fileIdx.get(rel)!, fileIdx.get(subject)!, "tests", 0.6, {
            strategy: "test-naming-convention", rule: "testthat-filename", source: stem,
          });
        }
      }
    }
  });

  // Call edges: resolve callee by name, prefer same-file, then imported files,
  // then a globally unique definition. Conductance decays with definition
  // cardinality: a name defined twice is a pointer, a name defined 40 times
  // is ambient noise (the dynamic-language `str(`/`it(` hub failure mode).
  await forEachChunked(files, 256, (rel) => {
    const f = facts(rel);
    if (!f) return;
    const targets = importTargets.get(rel) ?? [];
    const imported = new Set(targets.map((target) => target.file));
    const bend = langFamily(rel) === "bend";
    const aliases = bend ? targets.filter((target) => target.alias).sort((a, b) => b.alias!.length - a.alias!.length) : [];
    for (const call of f.calls) {
      const alias = aliases.find((target) => call.callee.startsWith(`${target.alias}.`));
      const name = alias ? call.callee.slice(alias.alias!.length + 1) : call.callee;
      const pkgQual = PKG_QUALIFIER.exec(call.callee);
      if (pkgQual && ["r", "qmd", "rmd"].includes(langFamily(rel))) notePkgSite(pkgQuals, pkgQual[1]!, rel);
      // Section markers are navigation, not callables: a call whose name
      // matches a `# Title ----` line never invokes the marker.
      const cands = (byName.get(name.toLowerCase()) ?? []).filter((i) => nodes[i]!.kind !== "section" && (!bend ||
        (nodes[i]!.lang === "Bend" && nodes[i]!.name === name && nodes[i]!.file === (alias?.file ?? rel))));
      if (!cands.length || cands.length > 48) continue;
      let strategy: EdgeEvidence["strategy"] = "same-file-symbol";
      let chosen: number[] = cands.filter((i) => nodes[i]!.file === rel);
      if (!chosen.length) {
        strategy = "imported-symbol";
        chosen = cands.filter((i) => imported.has(nodes[i]!.file));
      }
      if (!chosen.length && cands.length === 1) {
        strategy = "globally-unique-symbol";
        chosen = cands;
      }
      if (!chosen.length || chosen.length > 3) continue;
      const w = cands.length <= 8 ? 0.7 : cands.length <= 24 ? 0.45 : 0.25;
      const from = enclosingIdx(rel, call.line);
      for (const to of chosen) {
        pushEdge(from, to, "invokes", w, { strategy, rule: "call-target-resolution", source: call.callee, candidates: cands.length });
      }
    }
  });

  // External package nodes: opt-in surfaces, kept out of every backbone path
  // by low-conductance edges; focus("dplyr") lights the using files.
  if (pkgSites.size || pkgQuals.size) {
    const declared = declaredPackages(root);
    const declaredHas = (name: string): boolean | undefined =>
      declared === undefined ? undefined : declared.has(name) || [...declared].some((d) => d.toLowerCase() === name.toLowerCase());
    for (const key of new Set([...pkgSites.keys(), ...pkgQuals.keys()])) {
      const name = pkgSites.get(key)?.name ?? pkgQuals.get(key)!.name;
      const declaredState = declaredHas(name);
      // Python chunk imports join the same pkg: surfaces but are not R
      // dependencies: label them Python packages and skip R classification.
      const origins = new Set([...(pkgSites.get(key)?.origins ?? []), ...(pkgQuals.get(key)?.origins ?? [])]);
      const fromPython = origins.has("python");
      const label = fromPython ? (origins.has("r") ? "package" : "Python package") : "R package";
      const idx = addNode(nodes, seen, {
        id: `pkg:${name}`, name, kind: "package", file: "", line: 0,
        sig: `${label} ${name}${fromPython ? "" : declaredState === undefined ? "" : declaredState ? " · declared in DESCRIPTION" : R_BASE_PACKAGES.has(name.toLowerCase()) ? " · base package" : " · used without DESCRIPTION entry"}`,
        lang: "external",
      });
      const importFiles = pkgSites.get(key)?.files ?? new Set<string>();
      for (const file of new Set([...importFiles, ...(pkgQuals.get(key)?.files ?? [])])) {
        pushEdge(fileIdx.get(file)!, idx, "imports", 0.15, {
          strategy: importFiles.has(file) ? "package-import" : "qualified-call",
          rule: importFiles.has(file) ? "r-library" : "r-qualified-call",
          source: name,
        });
      }
    }
  }

  // Inherits edges from class signatures (TS/py style visible on the sig line).
  nodes.forEach((node, i) => {
    if (node.kind !== "class") return;
    for (const match of node.sig.matchAll(/extends\s+([A-Za-z_$][\w$.]*)/g)) {
      const candidates = byName.get(match[1]!.toLowerCase()) ?? [];
      for (const to of candidates) {
        pushEdge(i, to, "inherits", 0.9, {
          strategy: "signature-extends", rule: "extends-clause", source: match[1]!, candidates: candidates.length,
        });
      }
    }
    const impl = /implements\s+([A-Za-z_$][\w$.,\s]*)/.exec(node.sig);
    if (impl) {
      for (const raw of impl[1]!.split(",")) {
        const name = raw.trim();
        const candidates = byName.get(name.toLowerCase()) ?? [];
        for (const to of candidates) {
          pushEdge(i, to, "inherits", 0.9, {
            strategy: "signature-implements", rule: "implements-clause", source: name, candidates: candidates.length,
          });
        }
      }
    }
  });

  // Literal join edges (the cross-language bridge).
  const allSites: LiteralSite[] = [];
  for (const f of factValues()) for (const literal of f.literals) allSites.push(literal);
  const joinIdx = buildJoinIndex(allSites, (file, line) => enclosingIdx(file, line));
  for (const edge of joinIdx.edges) pushEdge(edge.a, edge.b, "join", edge.w, edge.evidence);

  // Anchors: one node per exact feature id, not per site. Registrations, schema
  // declarations, and consumers carrying that id meet at the same hub. Site
  // conductance decays with sqrt(count) so a common feature cannot dominate.
  const drafts: AnchorDraft[] = [];
  for (const rel of files) {
    const f = facts(rel);
    if (f) for (const anchor of f.anchors) drafts.push(anchor);
  }
  const draftsByLabel = new Map<string, AnchorDraft[]>();
  for (const anchor of drafts) {
    (draftsByLabel.get(anchor.id) ?? draftsByLabel.set(anchor.id, []).get(anchor.id)!).push(anchor);
  }
  const anchors: Graph["anchors"] = [];
  for (const [label, sites] of draftsByLabel) {
    const first = sites[0]!;
    const filesOf = [...new Set(sites.map((site) => site.file))];
    const sources = [...new Set(sites.map((site) => site.ruleId).filter((source): source is string => !!source))].sort();
    // A hub is implicit only when EVERY site came from a discovered rule — a
    // match by any declared rule upgrades it back to first-class instantly.
    const hubImplicit = sites.every((site) => site.implicit === true);
    anchors.push({
      id: label,
      kind: first.kind,
      label: sites.length > 1 ? `${label} · ${sites.length} sites` : label,
      nodeId: first.nodeId,
      file: first.file,
      line: first.line,
      ...(sources.length ? { sources } : {}),
      ...(hubImplicit ? { implicit: true } : {}),
    });
    const idx = addNode(nodes, seen, {
      id: `anchor:${label}`, name: label, kind: "anchor", file: first.file, line: first.line,
      sig: `${hubImplicit ? "(△ discovered) " : ""}${sites.length > 1 ? `${label} (${sites.length} sites)` : label}`, lang: "anchor",
    });
    (byFile.get(first.file) ?? byFile.set(first.file, []).get(first.file)!).push(idx);
    const w = (hubImplicit ? 0.5 : 1) / Math.sqrt(sites.length);
    for (const site of sites) {
      const handler = seen.get(site.nodeId) ?? fileIdx.get(site.file)!;
      pushEdge(idx, handler, "anchors", w, {
        strategy: site.implicit ? "discovered-anchor" : "declared-anchor",
        rule: site.ruleId ?? "legacy-anchor",
        source: `${site.file}:${site.line}`,
        candidates: sites.length,
        key: label,
        ...(site.implicit ? { implicit: true } : {}),
      });
    }
    if (filesOf.length > 1 && filesOf.length <= 12) {
      const fw = 0.35 / Math.sqrt(filesOf.length);
      for (const file of filesOf) {
        pushEdge(idx, fileIdx.get(file)!, "anchors", fw, {
          strategy: "anchor-membership",
          rule: "feature-file-membership",
          source: file,
          candidates: filesOf.length,
          key: label,
          ...(hubImplicit ? { implicit: true } : {}),
        });
      }
    }
  }

  return { graph: { nodes, edges, byName, byFile, anchors, files, importCoverage }, joinIndex: joinIdx };
};
