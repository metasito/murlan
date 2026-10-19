// tools/loop/tests/helpers/portReads.ts
//
// The port members a function body reads, from its syntax tree: `tracker.pick`, and
// `ports.ledger.journal` as `ledger.journal`.
import ts from "typescript";

export const PORTS = ["tracker", "workspace", "session", "ledger"] as const;
const named = new Set<string>(PORTS);

const portOf = (e: ts.Expression): string | null => {
  if (ts.isIdentifier(e) && named.has(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && named.has(e.name.text)) return e.name.text;
  return null;
};

/** `port.member` for every member read inside the named top-level functions or consts of `source`. */
export function portReads(source: string, within: string[]): Set<string> {
  const file = ts.createSourceFile("m.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const reads = new Set<string>();
  const found = new Set<string>();
  const walk = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const port = portOf(node.expression);
      if (port) reads.add(`${port}.${node.name.text}`);
    }
    ts.forEachChild(node, walk);
  };
  for (const statement of file.statements) {
    const decls = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
    for (const d of decls) {
      const name = (d as ts.FunctionDeclaration | ts.VariableDeclaration).name;
      if (name && ts.isIdentifier(name) && within.includes(name.text)) {
        found.add(name.text);
        walk(d);
      }
    }
  }
  const missing = within.filter((w) => !found.has(w));
  if (missing.length) throw new Error(`no top-level ${missing.join(", ")} to scan`);
  return reads;
}

/** The reads no port in `ports` carries. */
export const unknownReads = (reads: Set<string>, ports: Record<string, Record<string, unknown>>) =>
  [...reads].filter((r) => {
    const [port, member] = r.split(".");
    return !(member in (ports[port] ?? {}));
  });
