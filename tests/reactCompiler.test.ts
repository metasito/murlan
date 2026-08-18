// tests/reactCompiler.test.ts — the game table stays under the React Compiler.
//
// app.json turns on `experiments.reactCompiler`, which babel-preset-expo turns
// into babel-plugin-react-compiler with `panicThreshold: 'NONE'` for a
// production build: a component the compiler cannot handle is left uncompiled
// with no error and no warning, and the hand is rebuilt three to five times per
// move. A single `eslint-disable react-hooks` comment is enough to cause it —
// the compiler refuses to optimise any component in a file that switches those
// rules off.
//
// So this compiles the hot-path files the way the build does and reads the
// plugin's own diagnostics. It is an acceptance test rather than a grep,
// because a bailout has several possible causes (a suppressed lint rule,
// a ref written during render, manual memoization the compiler cannot preserve)
// and only the compiler knows which of them are present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(repoRoot, "package.json"));
const { transformSync } = require("@babel/core");
const reactCompiler = require("babel-plugin-react-compiler");

/**
 * Everything the game table is built from. GameTable.tsx itself is absent on
 * purpose: it bails on its own `useMemo`s, which is why the card components it
 * renders are wrapped in React.memo by hand instead of relying on the compiler.
 */
const HOT_PATH = [
  "components/CardView.tsx",
  "components/GameShared.tsx",
  "app/game.tsx",
  "app/(online)/game.tsx",
];

/** babel-preset-expo/build/index.js, for a production client build. */
const COMPILER_OPTIONS = {
  target: "19",
  environment: { enableResetCacheOnSourceFileChanges: false },
  panicThreshold: "NONE",
};

type CompilerEvent = {
  kind: string;
  fnLoc?: { start?: { line?: number } };
  detail?: { reason?: string; description?: string };
};

function bailouts(rel: string): CompilerEvent[] {
  const events: CompilerEvent[] = [];
  const filename = path.join(repoRoot, rel);
  transformSync(readFileSync(filename, "utf8"), {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [
      [
        reactCompiler.default ?? reactCompiler,
        { ...COMPILER_OPTIONS, logger: { logEvent: (_f: string, e: CompilerEvent) => events.push(e) } },
      ],
    ],
  });
  return events.filter((e) => e.kind === "CompileError");
}

for (const rel of HOT_PATH) {
  test(`${rel} compiles with no bailouts`, () => {
    const failed = bailouts(rel);
    assert.deepEqual(
      failed.map((e) => `${rel}:${e.fnLoc?.start?.line} — ${e.detail?.reason ?? e.detail?.description}`),
      [],
      `${rel} has components the React Compiler silently skipped. In a production build they are ` +
        `shipped unmemoized, and every card in the hand is rebuilt on every render of the table.`
    );
  });
}

// The failure mode this exists to make impossible: proving the counterfactual,
// so the test above cannot be satisfied by weakening the compiler options.
test("a suppressed react-hooks rule is what the compiler refuses to compile", () => {
  const filename = path.join(repoRoot, "components/CardView.tsx");
  const source = readFileSync(filename, "utf8").replace(
    "  }, [selected, noLift, reduceMotion, translateY]);",
    "  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [selected, noLift]);"
  );
  const events: CompilerEvent[] = [];
  transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    plugins: [
      [
        reactCompiler.default ?? reactCompiler,
        { ...COMPILER_OPTIONS, logger: { logEvent: (_f: string, e: CompilerEvent) => events.push(e) } },
      ],
    ],
  });
  const reasons = events
    .filter((e) => e.kind === "CompileError")
    .map((e) => e.detail?.reason ?? e.detail?.description ?? "");
  assert.ok(
    reasons.some((r) => r.includes("ESLint")),
    "adding a react-hooks suppression back no longer costs the component its compilation — " +
      "either the compiler options here drifted from babel-preset-expo's, or the plugin changed"
  );
});
