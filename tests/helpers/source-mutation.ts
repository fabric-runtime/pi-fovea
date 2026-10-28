import ts from "typescript";

interface Token {
  kind: ts.SyntaxKind;
  value: string;
  start: number;
  end: number;
}

function tokens(source: string): Token[] {
  // The parser, unlike a context-free scanner, rescans template tails and
  // regular expressions correctly. It also retains the real tokens of the
  // intentionally incomplete expression fragments used as mutation targets.
  const ast = ts.createSourceFile("mutation.ts", source, ts.ScriptTarget.Latest, true);
  const result: Token[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JSDocComment) return;
    const children = node.getChildren(ast);
    if (children.length) {
      for (const child of children) visit(child);
    } else if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.getWidth(ast) > 0) {
      result.push({
        kind: node.kind,
        value: ts.isStringLiteral(node) ? node.text : node.getText(ast),
        start: node.getStart(ast),
        end: node.getEnd(),
      });
    }
  };
  visit(ast);
  // A formatter may insert trailing commas; these do not change a mutation's target.
  return result.filter(
    (token, index) =>
      token.kind !== ts.SyntaxKind.CommaToken ||
      ![
        ts.SyntaxKind.CloseParenToken,
        ts.SyntaxKind.CloseBracketToken,
        ts.SyntaxKind.CloseBraceToken,
      ].includes(result[index + 1]?.kind ?? ts.SyntaxKind.Unknown),
  );
}

/** Replace exactly one token sequence, ignoring only trivia, quotes and trailing commas. */
export function replaceSource(source: string, before: string, after: string): string {
  const input = tokens(source);
  const target = tokens(before);
  if (!target.length) throw new Error("Empty source mutation");
  const matches: number[] = [];
  for (let start = 0; start <= input.length - target.length; start++) {
    if (
      target.every((token, offset) => {
        const candidate = input[start + offset]!;
        return candidate.kind === token.kind && candidate.value === token.value;
      })
    )
      matches.push(start);
  }
  if (matches.length !== 1)
    throw new Error(`Expected one source mutation target, found ${matches.length}: ${before}`);
  const first = input[matches[0]!]!;
  const last = input[matches[0]! + target.length - 1]!;
  return source.slice(0, first.start) + after + source.slice(last.end);
}
