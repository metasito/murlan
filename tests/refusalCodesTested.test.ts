import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "./helpers/sourceScan.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SELF = path.basename(import.meta.filename);

function declarationOf(name: ts.Identifier): ts.VariableDeclaration | ts.ParameterDeclaration | undefined {
  for (let scope: ts.Node | undefined = name.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const param = scope.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name.text);
      if (param) return param;
    }
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : [];
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const found = statement.declarationList.declarations.find(
        (d) => ts.isIdentifier(d.name) && d.name.text === name.text
      );
      if (found) return found;
    }
  }
  return undefined;
}

/** The literals an expression can evaluate to, following constants, ternary branches and a helper's parameter back to its calls. */
function literalsOf(expr: ts.Expression, sf: ts.SourceFile, unread: string[]): string[] {
  const where = () => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(expr.getStart()).line + 1}`;
  if (ts.isStringLiteralLike(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr)) return literalsOf(expr.expression, sf, unread);
  if (ts.isConditionalExpression(expr)) {
    return [...literalsOf(expr.whenTrue, sf, unread), ...literalsOf(expr.whenFalse, sf, unread)];
  }
  const decl = ts.isIdentifier(expr) ? declarationOf(expr) : undefined;
  const isConst = (d: ts.Node): d is ts.VariableDeclaration =>
    ts.isVariableDeclaration(d) && (d.parent.flags & ts.NodeFlags.Const) !== 0;
  if (decl && isConst(decl) && decl.initializer) return literalsOf(decl.initializer, sf, unread);
  const helper = decl && ts.isParameter(decl) ? decl.parent.parent : undefined;
  if (decl && helper && isConst(helper)) {
    const index = (decl.parent as ts.SignatureDeclaration).parameters.indexOf(decl as ts.ParameterDeclaration);
    const args: ts.Expression[] = [];
    const findCalls = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && declarationOf(n.expression) === helper) {
        if (n.arguments[index]) args.push(n.arguments[index]);
      }
      ts.forEachChild(n, findCalls);
    };
    findCalls(sf);
    if (args.length > 0) return args.flatMap((arg) => literalsOf(arg, sf, unread));
  }
  unread.push(where());
  return [];
}

/** Every code an object literal saying `ok: false` can carry, and every such `code` the scan could not resolve. */
function refusalCodes(
  files: [string, string][] = readdirSync(path.join(REPO_ROOT, "server"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [`server/${f}`, readFileSync(path.join(REPO_ROOT, "server", f), "utf8")])
): { codes: Map<string, string>; unread: string[] } {
  const codes = new Map<string, string>();
  const unread: string[] = [];
  for (const [file, source] of files) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (name: string) =>
          node.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === name);
        const ok = prop("ok");
        const code = prop("code");
        if (ok && ts.isPropertyAssignment(ok) && ok.initializer.kind === ts.SyntaxKind.FalseKeyword && code) {
          const expr = ts.isPropertyAssignment(code) ? code.initializer : (code as ts.ShorthandPropertyAssignment).name;
          for (const literal of literalsOf(expr, sf, unread)) codes.set(literal, sf.fileName);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { codes, unread };
}

test("a reassigned code is unread, and a same-named helper elsewhere is not followed", () => {
  const { codes, unread } = refusalCodes([
    ["a.ts", `function f(bad) { let code = "FIRST"; if (bad) code = "UNSEEN"; return { ok: false, code }; }`],
    [
      "b.ts",
      `function g() { const refuse = (code) => ({ ok: false, code }); return refuse("REAL"); }
       function h() { const refuse = (label) => ({ label }); return refuse("LABEL"); }`,
    ],
  ]);
  assert.deepEqual([...codes.keys()], ["REAL"]);
  assert.equal(unread.length, 1);
});

test("every refusal code the server returns is named by a test", () => {
  const { codes, unread } = refusalCodes();
  assert.deepEqual(unread, [], "a refusal code the scan cannot resolve to a literal is one it exempts");
  for (const known of ["NOT_THE_HOST", "ROOM_NOT_WAITING", "NOT_THIS_INSTANCE", "SEAT_RELEASED", "MIN_PLAYERS_REQUIRED"]) {
    assert.ok(codes.has(known), `the scan no longer finds ${known}, so it is not reading what it claims to`);
  }
  assert.ok(!codes.has("not_waiting"), "the scan read a ternary's condition as a code");

  const named = new Set<string>();
  for (const [file, source] of sourcesUnder(REPO_ROOT, ["tests"], /\.(ts|tsx|mjs)$/)) {
    if (path.basename(file) === SELF) continue;
    const collect = (n: ts.Node) => {
      if (ts.isStringLiteralLike(n)) named.add(n.text);
      ts.forEachChild(n, collect);
    };
    collect(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  }
  const untested = [...codes]
    .filter(([code]) => !named.has(code))
    .map(([code, where]) => `${code} (${where})`);
  assert.deepEqual(untested, [], "a refusal no test provokes is a guard a refactor can delete with CI green");
});
