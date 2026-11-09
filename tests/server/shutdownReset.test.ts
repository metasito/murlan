// A test that stages a shutdown ends it: the flag is process-wide, so a leftover one refuses every server the next test boots.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const SELF = "tests/server/shutdownReset.test.ts";

/** Local names a file gives what a module exports: `import { a as b }` yields b -> a. */
function importsFrom(source: ts.SourceFile, module: RegExp): Map<string, string> {
  const names = new Map<string, string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !module.test(stmt.moduleSpecifier.getText())) continue;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) names.set(el.name.text, (el.propertyName ?? el.name).text);
  }
  return names;
}

/** Whether the file stages a shutdown, resolved through its imports, and whether it then leaves it standing before the next test boots a server. */
export function stages(file: string, text: string): { staged: boolean; leaks: boolean } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const room = importsFrom(source, /gameRoom\.ts/);
  const shutdownModule = importsFrom(source, /http\/shutdown\.ts/);
  const staging = (name: string) => [...room].some(([local, real]) => local === name && real === "beginShutdown") || [...shutdownModule].some(([local, real]) => local === name && real === "shutdown");
  const resets = new Set([...room].filter(([, real]) => real === "__resetShutdown").map(([local]) => local));
  const boots = importsFrom(source, /testServer\.ts/).has("startTestServer");
  let lastStage = -1;
  let reset = false;
  const stops: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && resets.has(node.text) && !ts.isImportSpecifier(node.parent)) reset = true;
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && staging(node.expression.text)) lastStage = Math.max(lastStage, node.getStart());
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "stop") stops.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (lastStage < 0) return { staged: false, leaks: false };
  if (reset) return { staged: true, leaks: false };
  const inHook = (call: ts.CallExpression) => {
    for (let n: ts.Node | undefined = call.parent; n; n = n.parent) {
      if (ts.isCallExpression(n) && /^(?:t\.)?(?:after|afterEach)$/.test(n.expression.getText())) return true;
    }
    return false;
  };
  return { staged: true, leaks: !(boots && stops.some((call) => call.getStart() > lastStage || inHook(call))) };
}

const leaks = (file: string, text: string) => stages(file, text).leaks;

test("a test file that stages a shutdown ends it, by reset or by stopping the server it booted", () => {
  const files = sourcesUnder(repoRoot, ["tests"]).filter(([file]) => file !== SELF);
  const staged = files.filter(([file, text]) => stages(file, text).staged);
  assert.ok(staged.length >= 15, `the scan resolved a staged shutdown in only ${staged.length} files, so it proves nothing`);
  assert.deepEqual(staged.filter(([file, text]) => leaks(file, text)).map(([file]) => file), []);
});

test("the scan tells a leak from a reset, an aliased import from a stranger, and a stop that comes first", () => {
  const head = 'import { startTestServer } from "../helpers/testServer.ts";\nimport { beginShutdown as stage, __resetShutdown as undo } from "../../server/game/gameRoom.ts";\n';
  assert.equal(leaks("a.test.ts", `${head}test("x", () => { stage(); });`), true);
  assert.equal(leaks("a.test.ts", `${head}test("x", (t) => { t.after(undo); stage(); });`), false);
  assert.equal(leaks("a.test.ts", `${head}test("x", async () => { const s = await startTestServer(); stage(); await s.stop(); });`), false);
  assert.equal(leaks("a.test.ts", `${head}test("x", async () => { const s = await startTestServer(); await s.stop(); stage(); });`), true);
  assert.equal(leaks("a.test.ts", `${head}after(async () => { await s.stop(); });\ntest("x", () => { stage(); });`), false);
  assert.equal(leaks("a.test.ts", `${head}test("x", () => { startTestServer; stage(); });`), true);
  const viaShutdown = 'import { shutdown as down } from "../../server/http/shutdown.ts";\n';
  assert.equal(leaks("a.test.ts", `${viaShutdown}test("x", async () => { await down("SIGTERM", {}); });`), true);
  assert.equal(leaks("a.test.ts", 'import { beginShutdown } from "./elsewhere.ts";\ntest("x", () => { beginShutdown(); });'), false);
});
