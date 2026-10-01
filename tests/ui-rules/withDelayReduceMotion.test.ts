// Under the system's reduced motion Reanimated skips any `withDelay` not told otherwise (#1367):
// right for a stagger, a bug for a hold. Every call states which one it is.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATED = /^ReduceMotion\.(Never|System|Always)$/;

/** Every `withDelay(` call, as `path:line <its ReduceMotion argument, or "">`. */
function withDelayCalls(sources: [string, string][]): string[] {
  const out: string[] = [];
  for (const [file, text] of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
        if (ts.isIdentifier(callee) && callee.text === "withDelay") {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          out.push(`${file}:${line} ${n.arguments[2]?.getText(sf) ?? ""}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort();
}

const unstated = (calls: string[]) => calls.filter((c) => !STATED.test(c.slice(c.indexOf(" ") + 1)));

describe("every withDelay decides what reduced motion does to it", () => {
  const real = withDelayCalls(sourcesUnder(repoRoot, ["app", "components", "context", "lib"]));

  test("no call in the app leaves it to the default", () => {
    assert.deepEqual(
      unstated(real),
      [],
      "pass ReduceMotion.Never for a hold or a timer (dismissal, a callback, a clock), " +
        "ReduceMotion.System for a decorative stagger"
    );
  });

  test("the scan reads the real tree: the notification banner's hold is Never", () => {
    const banner = real.filter((c) => c.startsWith("components/NotificationBanner.tsx:"));
    assert.equal(banner.length, 2);
    for (const c of banner) assert.match(c, / ReduceMotion\.Never$/);
  });

  test("a planted call without the argument is flagged, one with it is not, a comment is not a call", () => {
    const planted: [string, string][] = [
      [
        "components/example.tsx",
        [
          "v.value = withDelay(400, withTiming(1));",
          "w.value = Reanimated.withDelay(400, withTiming(1, {}, () => {}));",
          "x.value = withDelay(400, withTiming(1), ReduceMotion.Never);",
          "// y.value = withDelay(400, withTiming(1));",
          'const s = "withDelay(400, withTiming(1))";',
        ].join("\n"),
      ],
    ];
    assert.deepEqual(unstated(withDelayCalls(planted)), ["components/example.tsx:1 ", "components/example.tsx:2 "]);
  });
});
