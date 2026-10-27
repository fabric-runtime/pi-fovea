import ts from "typescript";

/** Parse through TypeScript's public diagnostics API before walking its AST. */
export function parseSource(path: string, source: string, kind = ts.ScriptKind.TS): ts.SourceFile {
  const { diagnostics = [] } = ts.transpileModule(source, {
    fileName: path.replace(/\.d\.ts$/, ".ts"),
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
    },
  });
  if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error(`${path}: invalid proof source`);
  }
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}
