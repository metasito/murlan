const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

// The selectors live in eslint.selectors.cjs so tests/spacingLint can assert
// against the string this actually runs, rather than a copy of it.
const {
  SCALED_LITERAL,
  TOKEN_AS_STRING,
  TOKEN_AS_TEMPLATE,
  STRING_TOKEN_MESSAGE,
  SCALED_LITERAL_MESSAGE,
  TIMING_LITERAL,
  TIMING_LITERAL_MESSAGE,
  TOUCH_TARGET_LITERAL,
  TOUCH_TARGET_LITERAL_MESSAGE,
  HIT_SLOP_LITERAL,
  HIT_SLOP_LITERAL_MESSAGE,
} = require('./eslint.selectors.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output and agent tooling — never app code, never worth linting.
    ignores: [
      "dist/**",
      "static-build/**",
      "server_dist/**",
      ".expo/**",
      "node_modules/**",
      ".worktrees/**",
      "tests/e2e/playwright-report/**",
      "tests/e2e/test-results/**",
      ".scratch/**",
      // A Workflow script body is wrapped in an async function by its harness, so on its
      // own it is not a parseable module — it top-level `return`s the workflow's result.
      // Retired code, kept only for provenance. Its imports deliberately no longer resolve.
      ".claude/_archive/**",
      ".claude/workflows/**",
      // An agent's worktree is a second checkout living inside this one, build output and all.
      // Without this, one agent running anywhere turns everyone else's lint red.
      ".claude/worktrees/**",
    ],
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "context/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      // A wrong dependency array is a live-bug shape here, not a style nit —
      // it has shipped a stale closure twice (context/OnlineGameContext.tsx,
      // a round-winner banner). At the default "warn", `expo lint` still
      // exits 0, so the one check that would have caught either reports
      // nothing anyone sees. Every existing case that omits a real dependency
      // on purpose already carries its own `eslint-disable-next-line` with a
      // reason, which this does not affect.
      "react-hooks/exhaustive-deps": "error",
      // eslint-plugin-react-hooks 7 (pulled in by eslint-config-expo's SDK 57
      // bump) folds the React Compiler's static analysis into `recommended`,
      // newly flagging every `setState` call reachable from a `useEffect`
      // body — 17 of them here, all pre-existing and each one intentionally
      // syncing state to an external signal (a socket teardown, a media
      // query, a stored save). Adopting the rule means auditing each site for
      // the cascading-render risk it describes, not a mechanical rename like
      // `absoluteFillObject`; that audit is its own piece of work, tracked in
      // #891, not a rider on an SDK bump.
      "react-hooks/set-state-in-effect": "off",
      "no-restricted-syntax": [
        "error",
        {
          // `color: "Colors.success"` type-checks (any string is a valid
          // colour) and renders as nothing. The quotes are the whole bug.
          selector: TOKEN_AS_STRING,
          message: STRING_TOKEN_MESSAGE,
        },
        {
          selector: TOKEN_AS_TEMPLATE,
          message: STRING_TOKEN_MESSAGE,
        },
        {
          // FontSize, Radius and Spacing are the numeric scales the app is
          // swept onto. Neither the string-token rules above nor
          // tests/tokenRoles can see a bare number, which is how one screen
          // came to ship five corner radii for one role.
          selector: SCALED_LITERAL,
          message: SCALED_LITERAL_MESSAGE,
        },
        {
          // Timing was convention until #126 decided what the game should feel
          // like. The scale exists now, so a bare millisecond is the same
          // silent drift a bare radius was.
          selector: TIMING_LITERAL,
          message: TIMING_LITERAL_MESSAGE,
        },
        {
          selector: TOUCH_TARGET_LITERAL,
          message: TOUCH_TARGET_LITERAL_MESSAGE,
        },
        {
          selector: HIT_SLOP_LITERAL,
          message: HIT_SLOP_LITERAL_MESSAGE,
        },
      ],
    },
  },
  {
    // `eslint-config-expo` registers `@typescript-eslint` only for TS files, and
    // a flat-config block may only name a rule from a plugin registered for the
    // same file — which is why this names .ts/.tsx rather than every file.
    files: ["**/*.{ts,tsx}"],
    rules: {
      // `@ts-ignore` suppresses whatever error lands on the next line, for as
      // long as it stays there; `@ts-expect-error` goes red the moment the
      // error it names is gone. Only the self-cancelling form is allowed.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": "allow-with-description" },
      ],
    },
  },
  {
    // Everything here runs under Node, not in the app bundle, so it gets
    // Node's globals instead of the browser set `eslint-config-expo` assumes
    // for the client.
    files: ["*.config.{js,ts}", "scripts/**", "server/**", "tests/**"],
    languageOptions: { globals: globals.node },
    rules: {
      // Both rules exist because Metro inlines `process.env.X` into the client
      // bundle at build time and cannot inline a computed key. Node reads the
      // real environment at run time, so a computed key is correct here — it
      // is how the server takes its port, its database and its timeouts.
      "expo/no-dynamic-env-var": "off",
      "expo/no-env-var-destructuring": "off",
    },
  },
  {
    // Jest's own two idioms, both of which these rules read as mistakes.
    // `jest.mock()` is hoisted above the imports by babel-plugin-jest-hoist
    // whatever order it is written in, so the imports below it run second
    // either way and `import/first` is enforcing an order that does not
    // exist. `require()` after `jest.resetModules()` is the only way to get a
    // second, freshly-mocked copy of a module — a static import is bound once.
    files: ["tests/native/**/*.{ts,tsx}"],
    rules: {
      "import/first": "off",
      "@typescript-eslint/no-require-imports": "off",
      // A Probe/Harness component assigning a hook's return value to a
      // module-scope `let` — so the test body, which renders nothing of its
      // own, can call or read it — is this suite's standard way to reach a
      // hook from outside a component. eslint-plugin-react-hooks 7's
      // `globals` and `refs` rules (new in SDK 57's eslint-config-expo, see
      // the note on `set-state-in-effect` above) read every one of those
      // assignments as a component impurity. Tracked in #891 with the rest.
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["tests/e2e/**"],
    rules: {
      // Playwright names the callback that every fixture hands its value to
      // `use`, which this rule reads as a hook called outside a component.
      // The browser-automation suite renders no React of its own.
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);
