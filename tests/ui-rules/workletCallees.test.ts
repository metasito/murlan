// tests/ui-rules/workletCallees.test.ts — a worklet calls only worklets among its own file's functions.
//
// On the UI runtime a synchronous call to a plain JS function throws. Web and Jest run worklets on
// the JS thread, so no other check sees it: only the device does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const isWorklet = (fn: Fn) =>
  !!fn.body && ts.isBlock(fn.body) && fn.body.statements.some((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "worklet");

/** `file`'s worklets that call one of the file's own top-level functions that is not a worklet. */
export function plainCallees(file: string, source: string): { worklets: number; offenders: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const plain = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && !isWorklet(s)) plain.add(s.name.text);
    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && !isWorklet(d.initializer)) plain.add(d.name.text);
  }
  let worklets = 0;
  const offenders: string[] = [];
  const visit = (node: ts.Node, inWorklet: boolean) => {
    let inside = inWorklet;
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && isWorklet(node)) {
      worklets++;
      inside = true;
    }
    if (inside && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && plain.has(node.expression.text))
      offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} calls ${node.expression.text}`);
    ts.forEachChild(node, (c) => visit(c, inside));
  };
  visit(sf, false);
  return { worklets, offenders };
}

test("no worklet calls a plain function of its own file", () => {
  let worklets = 0;
  const offenders: string[] = [];
  const native = (rel: string) => !/\.web\.tsx?$/.test(rel);
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components"), ...sourcesUnder("lib")].filter(native)) {
    const r = plainCallees(rel, readFileSync(path.join(repoRoot, rel), "utf8"));
    worklets += r.worklets;
    offenders.push(...r.offenders);
  }
  assert.ok(worklets > 50, `the scan found only ${worklets} worklets: it is not reading the sources`);
  assert.deepEqual(offenders, [], "add \"worklet\" to each callee, or the UI thread throws on the device");
});

test("the scan flags a plain helper called from a worklet, and passes a worklet one", () => {
  const plain = `const meet = (a: number) => a > 1;\nexport function f(a: number) { "worklet"; return meet(a); }`;
  const fixed = `const meet = (a: number) => { "worklet"; return a > 1; };\nexport function f(a: number) { "worklet"; return meet(a); }`;
  assert.deepEqual(plainCallees("x.ts", plain).offenders, ["x.ts:2 calls meet"]);
  assert.deepEqual(plainCallees("x.ts", fixed).offenders, []);
});
