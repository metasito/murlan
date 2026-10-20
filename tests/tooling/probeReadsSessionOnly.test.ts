// The floor under audio-engine-owner's exemption of the probe (eslint.guards.cjs): it may read the
// session's latency, never configure it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROBE = path.join(repoRoot, "lib", "diagnostics", "probe.ts");
const SESSION = /(^|\/)murlan-audio-session(\/|$)/;
const READS = new Set(["outputLatencyMs", "ioBufferMs"]);

function sessionMisuse(source: string): string[] {
  const file = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const locals = new Set<string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !SESSION.test(stmt.moduleSpecifier.text)) continue;
    const clause = stmt.importClause;
    if (!clause?.name || clause.namedBindings) found.push(`import other than the default: ${stmt.getText()}`);
    if (clause?.name) locals.add(clause.name.text);
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg) && SESSION.test(arg.text)) found.push(`loads the module at run time: ${node.getText()}`);
    }
    if (ts.isIdentifier(node) && locals.has(node.text) && !ts.isImportClause(node.parent)) {
      const read = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && READS.has(node.parent.name.text) && ts.isCallExpression(node.parent.parent);
      if (!read) found.push(`uses the session other than to read latency: ${node.parent.getText()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("the probe only reads latency from the audio-session module", () => {
  const source = readFileSync(PROBE, "utf8");
  assert.ok(source.includes("murlan-audio-session"), "the probe no longer reads the audio-session module: drop its exemption and this test");
  assert.deepEqual(sessionMisuse(source), []);
});

test("a call that configures the session, an alias, a named import and a run-time load are each caught", () => {
  const head = 'import session from "@/modules/murlan-audio-session";\n';
  assert.deepEqual(sessionMisuse(head + "const a = session?.outputLatencyMs();\nconst b = session?.ioBufferMs();"), []);
  for (const code of [
    head + "session?.preferLowLatency();",
    head + "const s = session;",
    head + "const f = session?.outputLatencyMs;",
    'import session, { x } from "../../modules/murlan-audio-session";',
    'const m = require("@/modules/murlan-audio-session");',
    'const m = import("@/modules/murlan-audio-session/index.ts");',
  ]) {
    assert.equal(sessionMisuse(code).length, 1, code);
  }
});
