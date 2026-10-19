// `active_games` has one owner: `server/store/activeGameStore.ts` and the other
// stores, plus retention's age-based delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SCHEMA = "shared/schema";
const TABLE = "activeGames";
const TABLE_SQL = /\bactive_games\b/;

const owner = (file: string) => file.startsWith("server/store/") || file === "server/game/retention.ts";

function isSchema(file: string, spec: string): boolean {
  const bare = spec.startsWith("@shared/")
    ? `shared/${spec.slice("@shared/".length)}`
    : spec.startsWith("@/")
      ? spec.slice(2)
      : spec.startsWith(".")
        ? path.posix.join(path.posix.dirname(file), spec)
        : spec;
  return bare.replace(/\.ts$/, "") === SCHEMA;
}

const nameOf = (el: ts.ImportSpecifier | ts.ExportSpecifier | ts.BindingElement) =>
  ((el.propertyName ?? el.name) as ts.Identifier).text;

const isQuery = (node: ts.Expression) =>
  (ts.isPropertyAccessExpression(node) && node.name.text === "query") ||
  (ts.isIdentifier(node) && node.text === "query");

const literalText = (node: ts.Node): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("")
      : undefined;

function walk(file: string, text: string, visit: (node: ts.Node, source: ts.SourceFile) => void): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const go = (node: ts.Node) => {
    visit(node, source);
    ts.forEachChild(node, go);
  };
  go(source);
}

/** Every way a file outside the owners reaches the table, and every way an owner hands it on. */
function breaches(file: string, text: string): string[] {
  const hits: string[] = [];
  const handles = new Set<string>();
  walk(file, text, (node, source) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!isSchema(file, node.moduleSpecifier.text) || !clause || clause.isTypeOnly) return;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        handles.add(bindings.name.text);
        if (!owner(file)) hits.push(`import * as ${bindings.name.text}`);
      }
      for (const el of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
        if (el.isTypeOnly || nameOf(el) !== TABLE) continue;
        handles.add(el.name.text);
        if (!owner(file)) hits.push(`import { ${TABLE} }`);
      }
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const fromSchema = !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && isSchema(file, node.moduleSpecifier.text);
      const clause = node.exportClause;
      if (fromSchema && (!clause || ts.isNamespaceExport(clause))) hits.push("export * from schema");
      for (const el of clause && ts.isNamedExports(clause) ? clause.elements : []) {
        if (el.isTypeOnly) continue;
        if ((fromSchema && nameOf(el) === TABLE) || (!fromSchema && handles.has(nameOf(el)))) {
          hits.push(`export { ${nameOf(el)} }`);
        }
      }
    }
    if (owner(file)) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg) && isSchema(file, arg.text)) hits.push("import()");
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === TABLE && isQuery(node.expression)) {
      hits.push(`.query.${TABLE}`);
    }
    if (ts.isElementAccessExpression(node) && isQuery(node.expression) && literalText(node.argumentExpression) === TABLE) {
      hits.push(`.query["${TABLE}"]`);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isQuery(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      if (node.name.elements.some((el) => nameOf(el) === TABLE)) hits.push(`{ ${TABLE} } = query`);
    }
    if (ts.isTaggedTemplateExpression(node) && TABLE_SQL.test(literalText(node.template) ?? "")) {
      hits.push(`${node.tag.getText(source)}\`active_games\``);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const sqlArg = node.arguments.some((a) => TABLE_SQL.test(literalText(a) ?? ""));
      if (sqlArg && ["raw", "query", "execute"].includes(method)) hits.push(`.${method}("active_games")`);
    }
  });
  return hits;
}

/** A mock standing in for drizzle where it reads or writes the table, instead of the store's twin. */
function tableMocks(file: string, text: string): string[] {
  const hits: string[] = [];
  const names = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === TABLE) return true;
    if (TABLE_SQL.test(literalText(node) ?? "") || literalText(node) === TABLE) return true;
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && TABLE_SQL.test(node.getText())) return true;
    return ts.forEachChild(node, names) ?? false;
  };
  const isDb = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === "db") ||
    ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isDb(node.expression));
  walk(file, text, (node, source) => {
    if (ts.isCallExpression(node) && /\bmock\.method$/.test(node.expression.getText(source))) {
      const [target, ...rest] = node.arguments;
      if (target && isDb(target) && (names(target) || rest.some(names))) hits.push(`mock.method(${target.getText(source)})`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (isDb(node.left) && names(node.left)) hits.push(`${node.left.getText(source)} =`);
    }
  });
  return hits;
}

const scan = (sources: [string, string][], find: (file: string, text: string) => string[]) =>
  sources.flatMap(([file, text]) => find(file, text).map((hit) => `${file}: ${hit}`)).sort();

test("only the stores and retention reach the active_games table, and none hands it on", () => {
  assert.deepEqual(scan(sourcesUnder(REPO, ["server"]), breaches), []);
});

test("no test mocks drizzle where it reaches active_games; the store's twin stands in", () => {
  assert.deepEqual(scan(sourcesUnder(REPO, ["tests"]), tableMocks), []);
});

test("the server scan sees each way past the store", () => {
  const from = `"../../shared/schema.ts"`;
  const planted: [string, string][] = [
    ["game/a.ts", `import { activeGames } from ${from};`],
    ["game/b.ts", `import { activeGames as t } from ${from};`],
    ["http/c.ts", `import * as schema from ${from};`],
    ["game/d.ts", `const { activeGames } = await import(${from});`],
    ["game/e.ts", `await db.query.activeGames.findFirst({});`],
    ["game/f.ts", `await db.query["activeGames"].findFirst({});`],
    ["game/g.ts", `const { activeGames } = db.query;`],
    ["game/h.ts", `import { activeGames } from "@shared/schema";`],
    ["game/i.ts", `import { activeGames } from "@/shared/schema.ts";`],
    ["game/j.ts", `export { activeGames } from ${from};`],
    ["game/k.ts", `export * from ${from};`],
    ["http/l.ts", "await db.execute(sql`SELECT count(*) FROM active_games`);"],
    ["http/m.ts", "await pool.query(`DELETE FROM active_games WHERE room_id = $1`, [id]);"],
    ["http/n.ts", `await db.execute(sql.raw("DELETE FROM active_games"));`],
    ["store/o.ts", `import { activeGames } from ${from};\nexport { activeGames };`],
    ["store/p.ts", `import { activeGames as t } from ${from};\nexport { t as games };`],
    ["store/q.ts", `export * as schema from ${from};`],
    ["store/r.ts", `export { activeGames } from ${from};`],
    ["store/s.ts", `import * as schema from ${from};\nexport { schema };`],
    ["store/ok.ts", `import { activeGames } from ${from};\nawait db.execute(sql\`SELECT 1 FROM active_games\`);`],
    ["game/retention.ts", `import { activeGames } from ${from};`],
    ["game/ok1.ts", `import type { activeGames } from ${from};`],
    ["game/ok2.ts", `// db.query.activeGames is the store's\nimport { rooms } from ${from};`],
    ["game/ok3.ts", `logger.info({ roomId }, "Took over a table from active_games");`],
  ];
  const inServer = (rel: string) => ["server", rel].join("/");
  const found = scan(planted.map(([rel, text]) => [inServer(rel), text]), breaches);
  assert.deepEqual(found.map((hit) => hit.slice(inServer("").length)), [
    "game/a.ts: import { activeGames }",
    "game/b.ts: import { activeGames }",
    "game/d.ts: import()",
    "game/e.ts: .query.activeGames",
    "game/f.ts: .query[\"activeGames\"]",
    "game/g.ts: { activeGames } = query",
    "game/h.ts: import { activeGames }",
    "game/i.ts: import { activeGames }",
    "game/j.ts: export { activeGames }",
    "game/k.ts: export * from schema",
    "http/c.ts: import * as schema",
    "http/l.ts: sql`active_games`",
    "http/m.ts: .query(\"active_games\")",
    "http/n.ts: .raw(\"active_games\")",
    "store/o.ts: export { activeGames }",
    "store/p.ts: export { t }",
    "store/q.ts: export * from schema",
    "store/r.ts: export { activeGames }",
    "store/s.ts: export { schema }",
  ]);
});

test("the test scan sees each mock aimed at the table", () => {
  const planted: [string, string][] = [
    ["tests/a.ts", `t.mock.method(db.query.activeGames, "findFirst", async () => row);`],
    ["tests/b.ts", `t.mock.method(db.query["activeGames"], "findFirst", async () => row);`],
    ["tests/c.ts", `t.mock.method(db, "delete", (table) => { assert.equal(table, activeGames); });`],
    ["tests/d.ts", "mock.method(db, \"execute\", async (q) => (/active_games/.test(q) ? [] : rows));"],
    ["tests/e.ts", "t.mock.method(db, \"execute\", async () => { seen.push(`FROM active_games`); });"],
    ["tests/f.ts", `db.query.activeGames.findFirst = async () => row;`],
    ["tests/ok1.ts", `t.mock.method(activeGameStore, "load", async () => row);`],
    ["tests/ok2.ts", `t.mock.method(db, "insert", (table) => { assert.equal(table, rooms); });`],
    ["tests/ok3.ts", `const row = await db.query.activeGames.findFirst({ where });`],
  ];
  assert.deepEqual(scan(planted, tableMocks), [
    "tests/a.ts: mock.method(db.query.activeGames)",
    "tests/b.ts: mock.method(db.query[\"activeGames\"])",
    "tests/c.ts: mock.method(db)",
    "tests/d.ts: mock.method(db)",
    "tests/e.ts: mock.method(db)",
    "tests/f.ts: db.query.activeGames.findFirst =",
  ]);
});
