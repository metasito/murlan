// tests/reactCompiler.test.ts — every screen and component stays under the
// React Compiler.
//
// app.json turns on `experiments.reactCompiler`, which babel-preset-expo turns
// into babel-plugin-react-compiler with `panicThreshold: 'NONE'` for a
// production build: a component the compiler cannot handle is left uncompiled
// with no error and no warning, and the hand is rebuilt three to five times per
// move. So this compiles the app the way the build does and reads the plugin's
// own diagnostics, rather than grepping for the shapes that cause a bailout —
// there are several, and only the compiler knows which of them are present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(repoRoot, "package.json"));
const presetRequire = createRequire(
  path.join(repoRoot, "node_modules", "babel-preset-expo", "package.json")
);
const { transformSync } = require("@babel/core");
const reactCompiler = presetRequire("babel-plugin-react-compiler");

test("the compiler under test is the one babel-preset-expo builds with", () => {
  const built = presetRequire("babel-plugin-react-compiler/package.json").version;
  assert.throws(
    () => require("babel-plugin-react-compiler/package.json"),
    { code: "MODULE_NOT_FOUND" },
    `a top-level babel-plugin-react-compiler resolves again; babel-preset-expo already provides ` +
      `${built} and this suite must compile with that one copy, not a second one`
  );
});

function tsxUnder(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `${dir}/${f.split(path.sep).join("/")}`);
}

/**
 * Read off the filesystem, so a screen added tomorrow is covered the day it
 * lands. `context/SettingsContext.tsx` joins them because SettingsProvider
 * wraps every one of them.
 */
const COMPILED = [
  ...tsxUnder("app"),
  ...tsxUnder("components"),
  "context/SettingsContext.tsx",
  "context/GameContext.tsx",
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

function compile(rel: string, source?: string): CompilerEvent[] {
  const events: CompilerEvent[] = [];
  const filename = path.join(repoRoot, rel);
  transformSync(source ?? readFileSync(filename, "utf8"), {
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

test("every screen and component compiles with no bailouts", () => {
  const failures = COMPILED.flatMap((rel) =>
    compile(rel).map(
      (e) => `${rel}:${e.fnLoc?.start?.line} — ${e.detail?.reason ?? e.detail?.description}`
    )
  );
  assert.deepEqual(
    failures,
    [],
    "the React Compiler silently skipped these. In a production build they ship unmemoized and " +
      "the whole subtree is rebuilt on every render. Compile the file on its own with " +
      "`node scripts/react-compiler-probe.mjs <file>` to see why"
  );
});

// The floor for context/GameContext.tsx joining the assertion above: proving
// the counterfactual, so a directory cannot satisfy it by happening to
// compile clean today for a reason unrelated to the ref write this issue
// removed.
test("a render-time ref write is what the compiler refuses to compile in context/GameContext.tsx", () => {
  const rel = "context/GameContext.tsx";
  const original = readFileSync(path.join(repoRoot, rel), "utf8");
  const anchor = "  const [exchangeAnnouncing, setExchangeAnnouncing] = useState(false);";
  assert.ok(original.includes(anchor), `${rel} no longer contains the line this test patches`);
  const reasons = compile(
    rel,
    original.replace(
      anchor,
      `${anchor}\n  const gameStateRef = useRef<GameState | null>(null);\n  gameStateRef.current = gameState;`
    )
  ).map((e) => e.detail?.reason ?? e.detail?.description ?? "");
  assert.ok(
    reasons.some((r) => r.includes("Cannot access refs during render")),
    "writing a ref during render no longer costs GameProvider its compilation — either the ref " +
      "write moved somewhere the compiler tolerates, or the plugin changed"
  );
});

/**
 * Every `eslint-disable` directive, in either comment syntax, with its rule
 * list — which a block comment may spread over several lines.
 */
const DIRECTIVE =
  /\/\*\s*(eslint-disable(?:-next-line|-line)?)(?![\w-])([\s\S]*?)\*\/|\/\/\s*(eslint-disable(?:-next-line|-line)?)(?![\w-])([^\n]*)/g;

/**
 * A directive that switches react-hooks off. Naming no rule at all switches
 * off every rule, react-hooks among them, so a bare `/* eslint-disable *\/`
 * counts — it costs the file its compilation exactly as a named one does.
 */
function disablesReactHooks(body: string): boolean {
  const rules = body
    .split("--")[0]
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return rules.length === 0 || rules.some((r) => r.startsWith("react-hooks/"));
}

test("no react-hooks rule is switched off under app/, components/ or context/", () => {
  const found = ["app", "components", "context"]
    .flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .map((f) => `${dir}/${f.split(path.sep).join("/")}`)
    )
    .flatMap((rel) => {
      const source = readFileSync(path.join(repoRoot, rel), "utf8");
      return [...source.matchAll(DIRECTIVE)]
        .map((m) => ({
          directive: m[1] ?? m[3],
          body: m[2] ?? m[4] ?? "",
          line: source.slice(0, m.index).split("\n").length,
        }))
        .filter((d) => disablesReactHooks(d.body))
        .map((d) => `${rel}:${d.line} — ${d.directive} ${d.body.trim()}`.trimEnd());
    });
  assert.deepEqual(
    found,
    [],
    "the compiler skips any component whose React ESLint rules were switched off, so a " +
      "suppression is not a local decision — it silently opts the file out of the optimisation " +
      "the build is paying for"
  );
});

// The failure mode this exists to make impossible: proving the counterfactual,
// so the assertions above cannot be satisfied by weakening the compiler options.
test("a suppressed react-hooks rule is what the compiler refuses to compile", () => {
  const rel = "components/CardView.tsx";
  const original = readFileSync(path.join(repoRoot, rel), "utf8");
  const anchor = "  }, [selected, noLift, reduceMotion, translateY]);";
  assert.ok(original.includes(anchor), `${rel} no longer contains the effect this test patches`);
  const reasons = compile(
    rel,
    original.replace(
      anchor,
      "  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [selected, noLift]);"
    )
  ).map((e) => e.detail?.reason ?? e.detail?.description ?? "");
  assert.ok(
    reasons.some((r) => r.includes("ESLint")),
    "adding a react-hooks suppression back no longer costs the component its compilation — " +
      "either the compiler options here drifted from babel-preset-expo's, or the plugin changed"
  );
});
