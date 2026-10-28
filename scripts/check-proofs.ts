#!/usr/bin/env node
// Check without rewriting. Only --write replaces artifacts, after all laws pass.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { version as prettier } from "prettier";
import { parseSource } from "./parse-source.ts";
import { version as esbuild } from "esbuild";
import { verifyPortMap } from "./check-ports.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !["--write", "--artifact"].includes(args[0]!)))
  throw new Error("usage: tsx scripts/check-proofs.ts [--write|--artifact]");
const mode = args[0] ?? "--check";
const receipt = "src/verified/generated/manifest.json";
const outputs = [
  "src/verified/generated/kernel.js",
  "src/verified/generated/kernel.d.ts",
  "src/verified/generated/control.js",
  "src/verified/generated/control.d.ts",
  "src/verified/generated/limbs.js",
  "src/verified/generated/limbs.d.ts",
  "src/verified/generated/streams.js",
  "src/verified/generated/streams.d.ts",
];
const bridge = [
  "scripts/parse-source.ts",
  "scripts/check-proofs.ts",
  "scripts/compile-gdp.ts",
  "scripts/check-streams.ts",
  "scripts/check-series.ts",
  "scripts/check-completion.ts",
  "scripts/check-residual.ts",
  "scripts/check-operator-identity.ts",
  "scripts/check-operators.ts",
  "scripts/check-transport.ts",
  "scripts/check-focus.ts",
  "scripts/check-enclosures.ts",
  "scripts/check-normalization.ts",
  "scripts/check-ports.ts",
  "proofs/ports.json",
  "scripts/prove-polynomial.ts",
  "proofs/kernel-abi.json",
  "proofs/kernel-types.d.ts",
  "src/verified/policy.ts",
  "src/core/disclosure.ts",
  "src/core/numerics.ts",
  "src/core/interval.ts",
  "src/core/u32.ts",
  "src/core/heat-certificate.ts",
  "src/core/exact-operator.ts",
  "src/core/exact-heat.ts",
  "src/core/exact-series.ts",
  "src/core/normalization.ts",
  "src/substrate.ts",
  "proofs/ledger.json",
];
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const hashes = (paths: string[]) =>
  Object.fromEntries(paths.map((path) => [path, hash(read(path))]));
function sources() {
  const base = realpathSync(root),
    seen = new Set<string>();
  const visit = (path: string) => {
    const file = realpathSync(path),
      rel = relative(base, file);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Proof imports must stay inside the repository");
    if (seen.has(rel)) return;
    seen.add(rel);
    const source = readFileSync(file, "utf8"),
      ast = parseSource(file, source);
    const walk = (node: ts.Node) => {
      if (
        ts.isImportEqualsDeclaration(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      ) {
        throw new Error(`${rel}: dynamic or import-equals proof imports are forbidden`);
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier))
          throw new Error(`${rel}: invalid proof import`);
        const spec = node.moduleSpecifier.text;
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly
          : node.isTypeOnly;
        if (
          typeOnly &&
          ["gdp-wired/kernel", "gdp-wired/machine", "gdp-wired/solver"].includes(spec)
        )
          return;
        if (["gdp-wired", "gdp-wired/rationals", "gdp-wired/compose"].includes(spec)) return;
        if (!spec.startsWith("./") && !spec.startsWith("../"))
          throw new Error(`${rel}: unreviewed proof import ${spec}`);
        visit(resolve(dirname(file), spec));
      }
      if (
        ts.isIdentifier(node) &&
        ["eval", "Function", "process", "globalThis", "fetch", "require"].includes(node.text)
      )
        throw new Error(`${rel}: effectful proof source ${node.text}`);
      if (
        ts.isCallExpression(node) &&
        ((ts.isPropertyAccessExpression(node.expression) &&
          ["fns", "facts"].includes(node.expression.name.text)) ||
          (ts.isElementAccessExpression(node.expression) &&
            ts.isStringLiteral(node.expression.argumentExpression) &&
            ["fns", "facts"].includes(node.expression.argumentExpression.text)))
      )
        throw new Error(`${rel}: assumed foreign facts are forbidden`);
      ts.forEachChild(node, walk);
    };
    walk(ast);
  };
  for (const path of [
    "proofs/runtime/kernel.ts",
    "proofs/runtime/control.ts",
    "proofs/runtime/limbs.ts",
    "proofs/runtime/streams.ts",
    "proofs/kernel.ts",
    "proofs/controls.ts",
    "proofs/laws.ts",
    "proofs/heat.ts",
    "proofs/runtime.ts",
    "proofs/limbs.ts",
    "proofs/streams.ts",
    "proofs/series.ts",
    "proofs/completion.ts",
    "proofs/residual.ts",
    "proofs/operator-identity.ts",
    "proofs/operator-steps.ts",
    "proofs/transport.ts",
    "proofs/focus.ts",
    "proofs/enclosures.ts",
    "proofs/normalization.ts",
  ])
    visit(resolve(root, path));
  return [...new Set([...seen, ...bridge])].sort();
}
try {
  verifyPortMap(root);
  const metadata = {
    version: 3,
    toolchain: { gdpWired: "0.30.1", esbuild, typescript: ts.version, prettier },
    inputs: hashes(sources()),
  };
  if (mode === "--artifact") {
    if (
      JSON.stringify(JSON.parse(read(receipt))) !==
      JSON.stringify({ ...metadata, outputs: hashes(outputs) })
    )
      throw new Error("verified artifact is stale; run bun run proofs:generate");
    console.log(
      "verified kernel artifact matches sources, ABI, adapters and bridge (no prover loaded)",
    );
  } else {
    const packagePath = fileURLToPath(import.meta.resolve("gdp-wired/package.json"));
    if (JSON.parse(readFileSync(packagePath, "utf8")).version !== "0.30.1")
      throw new Error("Expected gdp-wired 0.30.1");
    const { checkLaws, compileKernel } = await import("./compile-gdp.ts");
    const count = checkLaws(root);
    const files = await compileKernel(root);
    files[receipt] =
      JSON.stringify(
        {
          ...metadata,
          outputs: Object.fromEntries(
            Object.entries(files).map(([path, text]) => [path, hash(text)]),
          ),
        },
        null,
        2,
      ) + "\n";
    for (const [path, text] of Object.entries(files)) {
      if (mode === "--write") {
        mkdirSync(dirname(resolve(root, path)), { recursive: true });
        writeFileSync(resolve(root, path), text);
      } else if (read(path) !== text)
        throw new Error(`${path}: verified artifact is stale; run bun run proofs:generate`);
    }
    console.log(
      `${count} laws proved and checked; executable kernels ${mode === "--write" ? "generated" : "reproduced byte-for-byte"}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
