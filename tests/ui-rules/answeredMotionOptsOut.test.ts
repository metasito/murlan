// A duration from `motionMs`/`noticeTiming` has already answered the app's reduced motion; left to
// the root's ReduceMotion.Always as well, Reanimated cuts it to nothing (#1390).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ANSWERING = new Set(["motionMs", "noticeTiming"]);
const TIMED = new Set(["withTiming", "withSpring"]);
const CARRIER_MODE_ARG: Record<string, number> = { withDelay: 2, withSequence: 0, withRepeat: 3 };

const calleeName = (n: ts.CallExpression): string | undefined => {
  const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
  return ts.isIdentifier(callee) ? callee.text : undefined;
};

/** The initializer `name` is bound to where `at` reads it, by walking out through the enclosing scopes. */
function binding(name: string, at: ts.Node): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = at.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) return undefined;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const st of scope.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const names = ts.isIdentifier(d.name) ? [d.name.text] : ts.isObjectBindingPattern(d.name)
          ? d.name.elements.flatMap((e) => (ts.isIdentifier(e.name) ? [e.name.text] : [])) : [];
        if (names.includes(name)) return d.initializer;
      }
    }
  }
  return undefined;
}

function answers(e: ts.Node | undefined, seen = new Set<ts.Node>()): boolean {
  if (!e || seen.has(e)) return false;
  seen.add(e);
  if (ts.isCallExpression(e) && ANSWERING.has(calleeName(e) ?? "")) return true;
  if (ts.isIdentifier(e) && !(ts.isPropertyAccessExpression(e.parent) && e.parent.name === e)) {
    return answers(binding(e.text, e), seen);
  }
  return ts.forEachChild(e, (c) => answers(c, seen) || undefined) ?? false;
}

/** `Never`, `System` or `Always` where `e` states one, through any `const` it is bound to. */
function mode(e: ts.Node | undefined): string | undefined {
  if (!e) return undefined;
  if (ts.isIdentifier(e)) return mode(binding(e.text, e));
  if (ts.isPropertyAccessExpression(e) && e.expression.getText() === "ReduceMotion") return e.name.text;
  if (ts.isObjectLiteralExpression(e)) {
    const prop = e.properties.find((p) => p.name?.getText() === "reduceMotion");
    return prop && ts.isPropertyAssignment(prop) ? mode(prop.initializer) : undefined;
  }
  return undefined;
}

/** The mode a timed leg runs under: its own, else the nearest enclosing carrier that states one. */
function inherited(n: ts.CallExpression): string | undefined {
  for (let up: ts.Node = n; up.parent; up = up.parent) {
    const p = up.parent;
    if (!ts.isCallExpression(p)) continue;
    const at = CARRIER_MODE_ARG[calleeName(p) ?? ""];
    const stated = at === undefined ? undefined : mode(p.arguments[at]);
    if (stated) return stated;
  }
  return undefined;
}

/** A layout chain's `.reduceMotion(…)`, from the `.duration(…)` call anywhere inside it. */
function chainMode(n: ts.CallExpression): string | undefined {
  let top: ts.Node = n;
  while (ts.isPropertyAccessExpression(top.parent) && ts.isCallExpression(top.parent.parent)) top = top.parent.parent;
  for (let c: ts.Node = top; ts.isCallExpression(c); c = (c.expression as ts.PropertyAccessExpression).expression) {
    if (!ts.isPropertyAccessExpression(c.expression)) break;
    if (c.expression.name.text === "reduceMotion") return mode(c.arguments[0]);
  }
  return undefined;
}

/** Every answered animation not opted out with ReduceMotion.Never, as `path:line <call>`. */
function unopted(sources: [string, string][]): string[] {
  const out: string[] = [];
  for (const [file, text] of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n) ?? "";
        const layout = name === "duration" && ts.isPropertyAccessExpression(n.expression);
        const flagged = TIMED.has(name)
          ? answers(n.arguments[1]) && (mode(n.arguments[1]) ?? inherited(n)) !== "Never"
          : layout && answers(n.arguments[0]) && chainMode(n) !== "Never";
        if (flagged) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          out.push(`${file}:${line} ${name}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort();
}

describe("an animation whose duration answers reduced motion opts out of the root's", () => {
  test("no answered animation in the app is left to ReduceMotion.System", () => {
    assert.deepEqual(
      unopted(sourcesUnder(repoRoot, ["app", "components", "context", "lib"])),
      [],
      "pass reduceMotion: ReduceMotion.Never (or .reduceMotion(ReduceMotion.Never) on a layout animation)"
    );
  });

  test("a planted answered animation is flagged however its duration or mode reaches it", () => {
    const source = [
      'a.value = withTiming(1, { duration: motionMs("reveal", r) });',
      'const d = motionMs("shift", r);',
      "b.value = withTiming(1, { duration: d });",
      "c.value = withSequence(withTiming(1, { duration: d }), withTiming(0, { duration: 300 }));",
      "e.value = withDelay(9, withTiming(1, { duration: d }), ReduceMotion.System);",
      'const f = <Animated.View exiting={FadeOut.duration(noticeTiming("chip", r).exit)} />;',
      'const cfg = { duration: motionMs("shift", r) };',
      "g.value = withTiming(1, cfg);",
      "h.value = withTiming(1, { duration: d, reduceMotion: ReduceMotion.Never });",
      "i.value = withDelay(9, withTiming(1, { duration: d }), ReduceMotion.Never);",
      "const ANSWERED = ReduceMotion.Never;",
      "j.value = withSequence(ANSWERED, withTiming(1, { duration: d }));",
      'const k = <Animated.View exiting={FadeOut.duration(noticeTiming("chip", r).exit).reduceMotion(ReduceMotion.Never)} />;',
      "l.value = withTiming(1, { duration: 300 });",
      "function other(ms: number) { m.value = withTiming(1, { duration: ms }); }",
      "function third() { const d = 300; n.value = withTiming(1, { duration: d }); }",
      '// o.value = withTiming(1, { duration: motionMs("reveal", r) });',
    ].join("\n");
    assert.deepEqual(unopted([["components/example.tsx", source]]), [
      "components/example.tsx:1 withTiming",
      "components/example.tsx:3 withTiming",
      "components/example.tsx:4 withTiming",
      "components/example.tsx:5 withTiming",
      "components/example.tsx:6 duration",
      "components/example.tsx:8 withTiming",
    ]);
  });
});
