import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const SCOPE = ["app", "components", "context", "lib"].map((d) => path.join(root, d) + path.sep);
const PROBE = path.join(root, "components", "__oneClockProbe.ts");
const MOTION_FILES = ["components/flightPose.ts", "lib/game/dealTimeline.ts", "lib/game/exchangeTimeline.ts"].map((p) => path.join(root, p));
const PHYSICS = path.join(root, "components", "flightPhysics.ts");
const TOKENS = path.join(root, "lib", "tokens.ts");

const PROBE_LINES = [
  `import { Motion, motionMs } from "../lib/tokens";`,
  `import { contactMs as touch } from "./flightPose";`,
  `import { withDelay, withTiming } from "react-native-reanimated";`,
  `import { scheduleOnRN } from "react-native-worklets";`,
  `import { useRef } from "react";`,
  `declare const done: () => void;`,
  `function hold() { return Motion.throw.card + 10; }`,
  `export function probe(landsAt: number) {`,
  `  setTimeout(done, Motion.throw.card);`,
  `  const wait = Motion.throw.stagger * 2;`,
  `  setTimeout(done, wait);`,
  `  const ref = useRef(0);`,
  `  ref.current = Date.now() + touch(1, [], [], false);`,
  `  setTimeout(done, ref.current - Date.now());`,
  `  withDelay(touch(1, [], [], false), withTiming(1));`,
  `  const { card } = Motion.throw;`,
  `  setTimeout(done, card);`,
  `  setTimeout(done, hold());`,
  `  [Motion.throw.card].forEach((ms) => setTimeout(done, ms));`,
  `  global.setTimeout(done, Motion.throw.card);`,
  `  withDelay(Motion.duration.shift, withTiming(1, {}, () => scheduleOnRN(done)));`,
  `  setTimeout(done, landsAt - performance.now());`,
  `  withDelay(Motion.duration.shift, withTiming(1));`,
  `  withDelay(motionMs("shift", false), withTiming(1));`,
  `}`,
];
const PROBE_FLAGGED = [
  "setTimeout(done, Motion.throw.card);",
  "setTimeout(done, wait);",
  "setTimeout(done, ref.current - Date.now());",
  "withDelay(touch(1, [], [], false), withTiming(1));",
  "setTimeout(done, card);",
  "setTimeout(done, hold());",
  "setTimeout(done, ms);",
  "global.setTimeout(done, Motion.throw.card);",
  "withDelay(Motion.duration.shift, withTiming(1, {}, () => scheduleOnRN(done)));",
];

const options = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
})!;

function scan(): { file: string; line: number; text: string }[] {
  const host = ts.createCompilerHost(options.options);
  const read = host.getSourceFile;
  host.getSourceFile = (file, ...rest) =>
    path.resolve(file) === PROBE ? ts.createSourceFile(file, PROBE_LINES.join("\n"), ts.ScriptTarget.Latest, true) : read(file, ...rest);
  const inScope = (f: string) => SCOPE.some((d) => path.resolve(f).startsWith(d)) && !f.endsWith(".d.ts");
  const program = ts.createProgram([...options.fileNames.filter(inScope), PROBE], options.options, host);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((f) => inScope(f.fileName));

  const resolve = (s: ts.Symbol | undefined) => (s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const writes = new Map<ts.Symbol, ts.Expression[]>();
  for (const f of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = ts.isPropertyAccessExpression(n.left) && n.left.name.text === "current" ? n.left.expression : n.left;
        const s = resolve(checker.getSymbolAtLocation(target));
        if (s) writes.set(s, [...(writes.get(s) ?? []), n.right]);
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }

  const labelOf = (id: ts.Identifier, s: ts.Symbol): string | null => {
    const decl = s.declarations?.[0];
    if (!decl) return null;
    const file = path.resolve(decl.getSourceFile().fileName);
    if (MOTION_FILES.includes(file)) return "flight";
    if (file === PHYSICS && /(Ms|_MS)$/.test(s.name) && ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) return "flight";
    if (file === TOKENS && s.name === "motionMs") return "duration";
    if (file === TOKENS && s.name === "Motion") {
      const p = id.parent;
      return ts.isPropertyAccessExpression(p) && p.expression === id && p.name.text === "duration" ? "duration" : "motion";
    }
    return null;
  };

  const labels = (node: ts.Node): Set<string> => {
    const out = new Set<string>();
    const seen = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const s = resolve(checker.getSymbolAtLocation(n));
        if (!s || seen.has(s)) return;
        seen.add(s);
        const label = labelOf(n, s);
        if (label) return void out.add(label);
        for (const d of s.declarations ?? []) {
          let root: ts.Node = d;
          while (ts.isBindingElement(root) || ts.isObjectBindingPattern(root) || ts.isArrayBindingPattern(root)) root = root.parent;
          if (ts.isVariableDeclaration(root) && root.initializer) visit(root.initializer);
          if (ts.isFunctionDeclaration(d) && d.body) {
            const returns = (b: ts.Node): void => {
              if (ts.isReturnStatement(b) && b.expression) visit(b.expression);
              if (!ts.isFunctionLike(b)) ts.forEachChild(b, returns);
            };
            ts.forEachChild(d.body, returns);
          }
          if (ts.isParameter(d) && (ts.isArrowFunction(d.parent) || ts.isFunctionExpression(d.parent))) {
            const call = d.parent.parent;
            if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) visit(call.expression.expression);
          }
        }
        for (const w of writes.get(s) ?? []) visit(w);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  };

  const TIMER_HOSTS = new Set(["global", "globalThis", "window"]);
  const timerName = (e: ts.Expression): string | null =>
    ts.isIdentifier(e) ? e.text
    : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && TIMER_HOSTS.has(e.expression.text) ? e.name.text
    : null;
  const CALLBACK_ARG: Record<string, number> = { withTiming: 2, withSpring: 2, withDecay: 1 };
  const reachesJs = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      if (name === "scheduleOnRN" || name === "runOnJS") return true;
      if (name in CALLBACK_ARG && n.arguments.length > CALLBACK_ARG[name]) return true;
    }
    return ts.forEachChild(n, reachesJs) ?? false;
  };

  const found: { file: string; line: number; text: string }[] = [];
  for (const f of files) {
    const visit = (n: ts.Node): void => {
      const name = ts.isCallExpression(n) ? timerName(n.expression) : null;
      if (name && ts.isCallExpression(n)) {
        const delay = name === "withDelay" ? n.arguments[0] : name === "setTimeout" || name === "setInterval" ? n.arguments[1] : undefined;
        if (delay) {
          const l = labels(delay);
          if (name === "withDelay" && !reachesJs(n)) l.delete("duration");
          if (l.size > 0) {
            const { line } = f.getLineAndCharacterOfPosition(n.getStart());
            found.push({ file: path.relative(root, f.fileName).replaceAll("\\", "/"), line: line + 1, text: n.getText(f) });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }
  return found;
}

const found = scan();

test("the planted probe is flagged on exactly the nine guessed delays", () => {
  const probe = found.filter((f) => f.file === "components/__oneClockProbe.ts").map((f) => `${f.text};`);
  assert.deepEqual(probe, PROBE_FLAGGED);
});

test("no timer in the app waits out a motion token: every landing consequence comes from the flight's contact", () => {
  const real = found.filter((f) => f.file !== "components/__oneClockProbe.ts").map((f) => `${f.file}:${f.line}  ${f.text}`);
  assert.deepEqual(real, [], "derive the time from the flight's reported landsAt (components/table/tableTimeline.ts), or react to it on the UI thread");
});
