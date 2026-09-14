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
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ADOPTED, SHIPPED } from "./helpers/adoptedHookRules.ts";
import { directives } from "./helpers/hookSuppression.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The shared checkout, via `--git-common-dir` rather than `--show-toplevel` (RULES.md rule 10:
// the latter returns the worktree's own path from inside one). `npm ls`, unlike `require()`,
// needs a real `node_modules` in its own cwd — only the shared checkout is guaranteed to have one.
const sharedCheckout = path.dirname(
  execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim()
);
const require = createRequire(path.join(repoRoot, "package.json"));
// Resolved through Node, not `repoRoot + "node_modules/…"`: a git worktree
// has no `node_modules` of its own and depends on the ancestor lookup
// finding the real one.
const presetRequire = createRequire(require.resolve("babel-preset-expo/package.json"));
const { transformSync, loadOptions } = require("@babel/core");
const reactCompiler = presetRequire("babel-plugin-react-compiler");

/**
 * Every occurrence of `name` anywhere in an `npm ls --json` dependency tree,
 * counted by walking `dependencies` recursively rather than by where npm's
 * own hoisting algorithm happened to place it on disk. Hoisting moved
 * `babel-plugin-react-compiler` to top-level `node_modules` under SDK 57
 * with no second entry in the tree — `npm ls --all` still showed exactly one
 * logical consumer — so a test that infers "one copy" from nesting depth
 * goes red on a layout change that changed nothing this invariant cares
 * about. This counts the dependency graph itself instead.
 */
function occurrencesInTree(name: string): number {
  // shell: true because npm ships as npm.cmd on Windows, which spawnSync
  // refuses to exec directly. Every argument here is a static literal, never
  // interpolated, so there is nothing for the shell to misinterpret.
  const tree = JSON.parse(
    execFileSync("npm", ["ls", name, "--all", "--json"], { cwd: sharedCheckout, encoding: "utf8", shell: true })
  ) as { dependencies?: Record<string, { dependencies?: unknown }> };
  let count = 0;
  const walk = (deps: Record<string, { dependencies?: unknown }> | undefined) => {
    if (!deps) return;
    for (const [pkgName, node] of Object.entries(deps)) {
      if (pkgName === name) count++;
      walk(node.dependencies as Record<string, { dependencies?: unknown }> | undefined);
    }
  };
  walk(tree.dependencies);
  return count;
}

test("the compiler under test is the one babel-preset-expo builds with", () => {
  const built = presetRequire("babel-plugin-react-compiler/package.json").version;
  const declared = { ...packageJson().dependencies, ...packageJson().devDependencies };
  assert.ok(
    !("babel-plugin-react-compiler" in declared),
    "package.json declares babel-plugin-react-compiler directly — babel-preset-expo already " +
      `provides ${built}; do not add a second copy to package.json`
  );
  assert.equal(
    occurrencesInTree("babel-plugin-react-compiler"),
    1,
    "the dependency tree resolves babel-plugin-react-compiler through more than one logical " +
      "consumer — babel-preset-expo must stay the only one"
  );
});

function packageJson(): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
}

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

/**
 * What babel-preset-expo passes babel-plugin-react-compiler for this repo,
 * asked of the preset rather than copied from it. `getReactCompilerPlugin` is
 * not exported and takes an options object the preset assembles internally, so
 * running babel.config.js through `loadOptions` is the only reading that cannot
 * drift from the build's. The caller is Metro's for a production client bundle;
 * get a flag wrong and the preset omits the plugin entirely rather than
 * erroring, which is what the assertion below is for.
 */
const COMPILER_OPTIONS = (() => {
  const { plugins } = loadOptions({
    root: repoRoot,
    configFile: path.join(repoRoot, "babel.config.js"),
    babelrc: false,
    filename: path.join(repoRoot, "components", "CardView.tsx"),
    caller: {
      name: "metro",
      bundler: "metro",
      platform: "ios",
      isDev: false,
      isServer: false,
      isReactServer: false,
      isNodeModule: false,
      isHMREnabled: false,
      supportsReactCompiler: true,
      supportsStaticESM: true,
    },
  }) as { plugins: { key: string; options?: Record<string, unknown> }[] };
  const entry = plugins.find((p) => p.key === "react-forget");
  assert.ok(
    entry?.options,
    "babel-preset-expo returned no babel-plugin-react-compiler entry for a production client " +
      "build, so either app.json stopped turning the compiler on or the caller flags this asks " +
      "with no longer reach it — and nothing below is compiling under the compiler at all"
  );
  return entry.options;
})();

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

const PROBE_REL = "components/suppressionProbe.tsx";

/**
 * A component that compiles clean, with one suppression inside it. The plugin
 * reads a suppression only where it overlaps a function the compiler visits, so
 * this goes in the body — the same comment above the `export` is free.
 */
const probeSuppressing = (rule: string) => `import { useState } from "react";
  export function Probe() {
    const [n, setN] = useState(0);
    // eslint-disable-next-line ${rule}
    return <div onClick={() => setN(n + 1)}>{n}</div>;
  }
`;

function bailoutReasons(rule: string): string[] {
  return compile(PROBE_REL, probeSuppressing(rule)).map(
    (e) => e.detail?.reason ?? e.detail?.description ?? ""
  );
}

/**
 * Which react-hooks rules a suppression of costs a file its compilation, asked
 * of the compiler rather than read off a list.
 *
 * `babel-plugin-react-compiler` honours only the rules on its
 * `eslintSuppressionRules` option; neither babel-preset-expo nor
 * `COMPILER_OPTIONS` sets one, so the plugin's own default stands — and that
 * default is a module-local constant the package does not export. Measuring it
 * through `compile()` is the only reading that cannot drift from the options
 * this suite compiles with (docs/adr/0005).
 */
const CHARGED_FOR = SHIPPED.filter((rule) =>
  bailoutReasons(rule).some((reason) => reason.includes("ESLint"))
);

test("the compiler is measured charging for a suppression, and only for that", () => {
  // Without this the list below can go empty — the probe stops compiling, or the
  // reason stops saying "ESLint" — and every assertion resting on it passes by
  // finding nothing.
  assert.ok(
    CHARGED_FOR.length > 0,
    "no react-hooks rule costs a file its compilation any more, which is either the probe no " +
      "longer reaching the compiler or the plugin dropping the mechanism"
  );
  assert.deepEqual(
    bailoutReasons("no-console"),
    [],
    "the probe bails out over a rule that is not the compiler's business, so what it measures " +
      "is the probe rather than the suppression"
  );
});

test("a suppression of a rule #891 adopted costs the compiler nothing", () => {
  // That these three are rules the plugin still ships is `adoptedHookRules.ts`'s
  // to refuse, at import — a renamed rule would leave this answering "none of
  // them" about three names nothing ships.
  assert.deepEqual(
    ADOPTED.filter((rule) => CHARGED_FOR.includes(rule)),
    [],
    "the compiler now charges for one of the three, so the reason tests/hooksLint.test.ts and " +
      "eslint.config.js give for refusing a suppression of it is no longer only the ESLint one"
  );
});

/**
 * Where `source` switches a react-hooks rule off, one line each.
 *
 * Every rule under the `react-hooks/` prefix, not the three `tests/hooksLint`
 * names, and every form ESLint honours, including the ones the compiler's own
 * suppression parser does not read. What is refused is a comment taking a rule
 * out of `eslint.config.js`'s hands one site at a time — an ESLint question,
 * which is why this is wider than `CHARGED_FOR`.
 *
 * `tests/hooksLint` asks a narrower question, whether the rules #891 adopted
 * stay on, and keeps its narrower list.
 */
function suppressions(source: string, file: string): string[] {
  return directives(source, file)
    .filter(
      ({ keyword, rules }) =>
        (keyword !== "eslint" && rules.length === 0) ||
        rules.some((rule) => rule.startsWith("react-hooks/"))
    )
    .map(({ line, keyword, rules }) =>
      `${file}:${line} — ${keyword} ${rules.join(", ")}`.trimEnd()
    );
}

test("each form the gate refuses is found, and a quoted one is not", () => {
  const found = (source: string) => suppressions(source, "components/X.tsx");
  assert.equal(found("/* eslint-disable */").length, 1);
  assert.equal(found('/* eslint react-hooks/refs: "off" */').length, 1);
  assert.equal(found('/* eslint react-hooks/refs: "error" */').length, 1);
  // Each disable syntax by its own text: a file-wide one and a single-line one
  // are a different amount of damage to report.
  assert.deepEqual(found("/* eslint-disable react-hooks/refs */"), [
    "components/X.tsx:1 — eslint-disable react-hooks/refs",
  ]);
  assert.deepEqual(found("// eslint-disable-next-line react-hooks/exhaustive-deps"), [
    "components/X.tsx:1 — eslint-disable-next-line react-hooks/exhaustive-deps",
  ]);
  assert.deepEqual(found("// eslint-disable-line react-hooks/refs"), [
    "components/X.tsx:1 — eslint-disable-line react-hooks/refs",
  ]);
  assert.deepEqual(found("// eslint-disable-next-line no-console"), []);
  assert.deepEqual(found("// the `react-hooks/refs` rule, which we do not disable"), []);
  // A directive is a directive only outside a string. This one is a fixture in
  // a test that asserts about suppressions, and the scan reads it as the thing
  // it describes.
  assert.deepEqual(found('const s = "/* eslint-disable */";'), []);
  assert.deepEqual(found("const s = `// eslint-disable-next-line react-hooks/refs`;"), []);
});

test("no react-hooks rule is switched off under app/, components/ or context/", () => {
  const found = ["app", "components", "context"]
    .flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .map((f) => `${dir}/${f.split(path.sep).join("/")}`)
    )
    .flatMap((rel) => suppressions(readFileSync(path.join(repoRoot, rel), "utf8"), rel));
  assert.deepEqual(
    found,
    [],
    "a suppression takes a react-hooks rule out of eslint.config.js's hands for one site, with " +
      "nothing repo-wide recording that it went. For the rules on CHARGED_FOR it also silently " +
      "opts the file out of the optimisation the build is paying for"
  );
});

// The failure mode this exists to make impossible: proving the counterfactual,
// so the assertions above cannot be satisfied by weakening the compiler options.
test("a suppressed react-hooks rule is what the compiler refuses to compile", () => {
  const rel = "components/CardView.tsx";
  // The suppression, not the effect it precedes: a rule the compiler charges for
  // being off anywhere inside a component is what costs it its compilation, so
  // nothing here reads a dependency array — the construct an exhaustive-deps
  // autofix rewrites unprompted.
  const { source, match } = anchored(rel, FIRST_EFFECT, "`useEffect(` call of its own");
  // Named here rather than left to interpolate as `undefined`, which reads in
  // `reasonsFor`'s message as an anchor that missed.
  const [charged] = CHARGED_FOR;
  assert.ok(charged, "CHARGED_FOR is empty, so there is no rule to suppress here");
  const reasons = reasonsFor(
    rel,
    `${source.slice(0, match.index)}${match[1]}// eslint-disable-next-line ${charged}\n${source.slice(match.index)}`
  );
  assert.ok(
    reasons.some((r) => r.includes("ESLint")),
    "adding a react-hooks suppression back no longer costs the component its compilation. The " +
      "options come from babel-preset-expo itself, so this is the plugin changing: either it " +
      "stopped charging for a suppression, or the preset turned that off"
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
