// `active_games` has one owner: `server/store/activeGameStore.ts` and the other
// stores, plus retention's age-based delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SCHEMA = "shared/schema";

const allowed = (file: string) => file.startsWith("server/store/") || file === "server/game/retention.ts";

function resolves(file: string, spec: string): string {
  return path.posix.join(path.posix.dirname(file), spec).replace(/\.ts$/, "");
}

/** Value imports of the `activeGames` table, by name or through a namespace import of the schema. */
function tableImports(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (resolves(file, node.moduleSpecifier.text) === SCHEMA && clause && !clause.isTypeOnly) {
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) hits.push(`import * as ${bindings.name.text}`);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (!el.isTypeOnly && (el.propertyName ?? el.name).text === "activeGames") hits.push("import { activeGames }");
          }
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg) && resolves(file, arg.text) === SCHEMA) hits.push("import()");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function violations(sources: [string, string][]): string[] {
  return sources
    .filter(([file]) => !allowed(file))
    .flatMap(([file, text]) => [
      ...tableImports(file, text),
      ...[...blankComments(text).matchAll(/\.query\.activeGames\b/g)].map((m) => m[0]),
    ].map((hit) => `${file}: ${hit}`))
    .sort();
}

test("only the stores and retention reach the active_games table", () => {
  assert.deepEqual(violations(sourcesUnder(REPO, ["server"])), []);
});

test("the scan sees each way past the store", () => {
  const planted: [string, string][] = [
    ["server/game/a.ts", `import { activeGames } from "../../shared/schema.ts";`],
    ["server/game/b.ts", `import { activeGames as t } from "../../shared/schema.ts";`],
    ["server/http/c.ts", `import * as schema from "../../shared/schema.ts";`],
    ["server/game/d.ts", `const { activeGames } = await import("../../shared/schema.ts");`],
    ["server/game/e.ts", `await db.query.activeGames.findFirst({});`],
    ["server/store/f.ts", `import { activeGames } from "../../shared/schema.ts";`],
    ["server/game/retention.ts", `import { activeGames } from "../../shared/schema.ts";`],
    ["server/game/g.ts", `import type { activeGames } from "../../shared/schema.ts";`],
    ["server/game/h.ts", `// db.query.activeGames is the store's\nimport { rooms } from "../../shared/schema.ts";`],
  ];
  assert.deepEqual(violations(planted), [
    "server/game/a.ts: import { activeGames }",
    "server/game/b.ts: import { activeGames }",
    "server/game/d.ts: import()",
    "server/game/e.ts: .query.activeGames",
    "server/http/c.ts: import * as schema",
  ]);
});
