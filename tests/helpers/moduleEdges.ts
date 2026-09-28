import path from "node:path";
import ts from "typescript";

export interface Edge {
  from: string;
  to: string;
  via: "import" | "require" | "mock";
  gated: boolean;
}

export function resolveSpec(file: string, spec: string): string {
  const bare = spec.startsWith("@/")
    ? spec.slice(2)
    : spec.startsWith(".")
      ? path.posix.join(path.posix.dirname(file), spec)
      : spec;
  return bare.replace(/\.(tsx?|mjs|js)$/, "").replace(/\/index$/, "");
}

const typeOnly = (clause: ts.ImportClause | undefined): boolean =>
  !!clause &&
  (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    (!clause.name &&
      !!clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((e) => e.isTypeOnly)));

function isDiagnosticsGate(node: ts.Expression, source: ts.SourceFile): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    node.left.getText(source) === "process.env.EXPO_PUBLIC_DIAGNOSTICS" &&
    ts.isStringLiteral(node.right) &&
    node.right.text === "1"
  );
}

export function moduleEdges(file: string, text: string): Edge[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: Edge[] = [];
  const add = (spec: string, via: Edge["via"], gated: boolean) =>
    out.push({ from: file, to: resolveSpec(file, spec), via, gated });
  const visit = (node: ts.Node, gated: boolean): void => {
    if (ts.isImportDeclaration(node) && !typeOnly(node.importClause) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, "import", false);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, "import", false);
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const spec = node.arguments[0].text;
      const callee = node.expression.getText(source);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(spec, "import", gated);
      else if (callee === "require" || callee === "jest.requireActual") add(spec, "require", gated);
      else if (/^jest\.(mock|doMock|setMock|unstable_mockModule)$/.test(callee)) add(spec, "mock", gated);
    }
    if (ts.isConditionalExpression(node) && isDiagnosticsGate(node.condition, source)) {
      visit(node.condition, gated);
      visit(node.whenTrue, true);
      visit(node.whenFalse, gated);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, gated));
  };
  visit(source, false);
  return out;
}
