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
// Resolved through Node, not `repoRoot + "node_modules/…"`: a git worktree
// has no `node_modules` of its own and depends on the ancestor lookup
// finding the real one.
const presetRequire = createRequire(require.resolve("babel-preset-expo/package.json"));
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

/**
 * A hook, by the only rule the compiler itself goes by: the name. Matching the
 * definition as well as the call is deliberate — a file that only declares
 * `useFoo` is exactly the file this was blind to — and `[(=]` rather than `\(`
 * so that an arrow-defined `export const useFoo = …` counts as a definition.
 *
 * Loose on purpose. A `.ts` file swept in that has no hook in it compiles clean
 * and costs a few milliseconds; one left out ships unmemoized and says nothing,
 * which is the defect this widening exists to end (docs/agents/RULES.md rule 6).
 */
const CALLS_A_HOOK = /\buse[A-Z]\w*\s*[(=]/;

/**
 * `.tsx` unconditionally, and `.ts` when it holds a hook.
 *
 * A hook extracted into a plain `.ts` file bails out for the same reasons and at
 * the same cost as one in a component, and the compiler skips the whole file in
 * silence. `components/useTableFeedback.ts` shipped that way for the life of
 * this gate.
 */
function compiledUnder(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => `${dir}/${f.split(path.sep).join("/")}`)
    .filter((rel) => rel.endsWith(".tsx") || CALLS_A_HOOK.test(readFileSync(path.join(repoRoot, rel), "utf8")));
}

/**
 * Read off the filesystem, so a screen or provider added tomorrow is covered
 * the day it lands.
 */
const COMPILED = [
  ...compiledUnder("app"),
  ...compiledUnder("components"),
  ...compiledUnder("context"),
  // `lib/` too: the production build compiles whatever the app imports, and
  // eight hooks live here — `usePrefersReducedMotion`, `useTranslation`,
  // `useFocusTrap` and the rest. Leaving the directory out would be the same
  // silent skip one level over.
  ...compiledUnder("lib"),
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

/**
 * Where a counterfactual injects. A construct the file holds, never an exact
 * line of it: these are files this suite does not own, and the coupling is
 * invisible from them, so a rename or a reordered dependency array must not be
 * able to unanchor a patch.
 */
function anchored(rel: string, construct: RegExp, what: string) {
  const source = readFileSync(path.join(repoRoot, rel), "utf8");
  const match = construct.exec(source);
  assert.ok(
    match,
    `${rel} holds no ${what}, which is where this counterfactual injects. Re-anchor it on ` +
      `another construct the file does have — never on an exact line of it`
  );
  return { source, match };
}

const STATE_DECLARATION = /^([ \t]*)const \[\w+, set\w+\] = useState/m;
const FIRST_EFFECT = /^([ \t]*)useEffect\(/m;
const DEPENDENCY_ARRAY = /\}, \[[^[\]\n]+\]\)/;

/**
 * A render-time ref write, in the body that declares the file's first piece of
 * state. It goes *before* that declaration and refers to nothing the file
 * declares, so neither a rename nor an initializer spanning lines can put it
 * anywhere but the top level of the body.
 */
function withRenderTimeRefWrite(rel: string): string {
  const { source, match } = anchored(rel, STATE_DECLARATION, "`const [x, setX] = useState…` declaration");
  const at = match.index;
  return `${source.slice(0, at)}${match[1]}const probeRef = useRef(null);\n${match[1]}probeRef.current = 1;\n${source.slice(at)}`;
}

/** Distinguishes an injection the compiler never saw from one it tolerated. */
function reasonsFor(rel: string, patched: string): string[] {
  const reasons = compile(rel, patched).map((e) => e.detail?.reason ?? e.detail?.description ?? "");
  assert.notEqual(
    reasons.length,
    0,
    `${rel} compiled clean with the bailout injected, so it landed outside every function the ` +
      `compiler visits — anchor this counterfactual inside one`
  );
  return reasons;
}

// The floor for context/GameContext.tsx joining the assertion above: proving
// the counterfactual, so a directory cannot satisfy it by happening to
// compile clean today for a reason unrelated to a render-time ref write.
test("a render-time ref write is what the compiler refuses to compile in context/GameContext.tsx", () => {
  const rel = "context/GameContext.tsx";
  const reasons = reasonsFor(rel, withRenderTimeRefWrite(rel));
  assert.ok(
    reasons.some((r) => r.includes("Cannot access refs during render")),
    "writing a ref during render no longer costs GameProvider its compilation — either the ref " +
      "write moved somewhere the compiler tolerates, or the plugin changed"
  );
});

// The floor for the `.ts` half, which is a separate claim from the `.tsx` one
// above: `COMPILED` reaching a plain `.ts` hook is worth nothing unless a
// bailout in one actually fails the assertion. This gate walked `.tsx` only for
// its whole life, and `components/useTableFeedback.ts` shipped uncompiled
// underneath it the entire time.
test("a bailout in a plain .ts hook is what the widened gate catches", () => {
  const rel = "components/useHandOrder.ts";
  assert.ok(
    COMPILED.includes(rel),
    `${rel} is not in COMPILED — the .ts half of the gate is reaching nothing`
  );
  assert.ok(
    COMPILED.some((f) => f.startsWith("lib/")),
    "no lib/ file reaches the gate; the hooks that live there are being skipped again"
  );
  const reasons = reasonsFor(rel, withRenderTimeRefWrite(rel));
  assert.ok(
    reasons.some((r) => r.includes("Cannot access refs during render")),
    `a render-time ref write in ${rel} compiled clean; the .ts half of the gate cannot fail`
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
  // The suppression, not the effect it precedes: a react-hooks rule being off
  // anywhere inside a component is what costs it its compilation, so nothing
  // here reads a dependency array — the construct an exhaustive-deps autofix
  // rewrites unprompted.
  const { source, match } = anchored(rel, FIRST_EFFECT, "`useEffect(` call of its own");
  const reasons = reasonsFor(
    rel,
    `${source.slice(0, match.index)}${match[1]}// eslint-disable-next-line react-hooks/exhaustive-deps\n${source.slice(match.index)}`
  );
  assert.ok(
    reasons.some((r) => r.includes("ESLint")),
    "adding a react-hooks suppression back no longer costs the component its compilation — " +
      "either the compiler options here drifted from babel-preset-expo's, or the plugin changed"
  );
});

/**
 * The two edits a rename or an exhaustive-deps autofix makes unprompted, each
 * paired with the construct it needs: an edit that quietly matches nothing must
 * not pass for a file that survived it.
 */
const ORDINARY_EDITS = [
  {
    what: "the first state pair renamed",
    needs: STATE_DECLARATION,
    apply: (source: string) => {
      const pair = /const \[(\w+), (set\w+)\] = useState/.exec(source);
      return pair ? source.replace(new RegExp(`\\b(?:${pair[1]}|${pair[2]})\\b`, "g"), "$&Renamed") : source;
    },
  },
  {
    what: "the first dependency array reversed",
    needs: DEPENDENCY_ARRAY,
    apply: (source: string) =>
      source.replace(/\}, \[([^[\]\n]+)\]\)/, (_whole, deps: string) => {
        const parts = deps.split(",").map((d) => d.trim());
        return `}, [${[...parts].reverse().join(", ")}])`;
      }),
  },
] as const;

// The property the anchors above are for, asserted rather than argued.
test("an ordinary edit leaves every counterfactual anchored", () => {
  for (const [rel, construct] of [
    ["context/GameContext.tsx", STATE_DECLARATION],
    ["components/useHandOrder.ts", STATE_DECLARATION],
    ["components/CardView.tsx", FIRST_EFFECT],
  ] as const) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const edit of ORDINARY_EDITS) {
      const edited = edit.apply(source);
      assert.equal(
        edited !== source,
        edit.needs.test(source),
        `${rel}: ${edit.what} did not do what its own construct says it should, so what this ` +
          `asserts about the file is not what it reads as`
      );
      assert.ok(
        construct.exec(edited),
        `${rel}: ${edit.what} unanchored the counterfactual that patches it; anchor that on a ` +
          `construct the edit cannot remove`
      );
    }
  }
});
