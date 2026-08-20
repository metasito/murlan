const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

// React Native renders an invalid colour as nothing at all — no warning, no
// fallback, just an invisible element. Every rule below targets a way to
// produce one that neither TypeScript nor a render test catches.
const TOKEN_OBJECTS = 'Colors|Spacing|Radius|FontSize|Type|Motion|Scrim|Highlight|Shadow|FeltGradient|FeltGradients|CardBacks';

// Every edge shorthand React Native accepts, built from the two prefixes and
// the edge suffixes rather than enumerated.
const SPACING_PROPS = '(padding|margin)(Top|Bottom|Left|Right|Start|End|Vertical|Horizontal|(Block|Inline)(Start|End)?)?|gap|rowGap|columnGap';
const SCALED_PROPS = `fontSize|borderRadius|${SPACING_PROPS}`;

// `raw`, not `value`: esquery only regex-matches an attribute that is already a
// string, so a numeric `value` matches nothing at all and the rule reports
// green. `-8` parses as a UnaryExpression over the literal, hence the second
// selector — one alone leaves half the scale unguarded.
const BARE_NUMBER = 'Literal[raw=/^[1-9][0-9.]*$/]';
const SCALED_LITERAL =
  `Property[key.name=/^(${SCALED_PROPS})$/] > ${BARE_NUMBER}, ` +
  `Property[key.name=/^(${SCALED_PROPS})$/] > UnaryExpression > ${BARE_NUMBER}`;

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output — never hand-written, never worth linting.
    ignores: [
      "dist/**",
      "static-build/**",
      "server_dist/**",
      ".expo/**",
      "node_modules/**",
      "tests/e2e/playwright-report/**",
      "tests/e2e/test-results/**",
    ],
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      // A wrong dependency array is a live-bug shape here, not a style nit —
      // it has shipped a stale closure twice (context/OnlineGameContext.tsx,
      // a round-winner banner). At the default "warn", `expo lint` still
      // exits 0, so the one check that would have caught either reports
      // nothing anyone sees. Every existing case that omits a real dependency
      // on purpose already carries its own `eslint-disable-next-line` with a
      // reason, which this does not affect.
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-syntax": [
        "error",
        {
          // `color: "Colors.success"` type-checks (any string is a valid
          // colour) and renders as nothing. The quotes are the whole bug.
          selector: `Literal[value=/^(${TOKEN_OBJECTS})\\.[A-Za-z0-9_]+$/]`,
          message:
            "This is a design token written as a string, so it resolves to no colour at all. Drop the quotes and reference the token directly.",
        },
        {
          selector: `TemplateElement[value.raw=/^(${TOKEN_OBJECTS})\\.[A-Za-z0-9_]+$/]`,
          message:
            "This is a design token written as a string, so it resolves to no colour at all. Drop the quotes and reference the token directly.",
        },
        {
          // FontSize, Radius and Spacing are the numeric scales the app is
          // swept onto. Neither the string-token rules above nor
          // tests/tokenRoles can see a bare number, which is how one screen
          // came to ship five corner radii for one role.
          selector: SCALED_LITERAL,
          message:
            "Use a FontSize, Radius or Spacing token. A one-off that fits no step may be a named module constant, but not a bare number in a style object.",
        },
      ],
    },
  },
  {
    // `eslint-config-expo` registers `@typescript-eslint` only for TS files, and
    // a flat-config block may only name a rule from a plugin registered for the
    // same file — a wider glob here fails config resolution on tests/**/*.mjs.
    files: ["tests/**/*.{ts,tsx}"],
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
    files: ["tests/e2e/**"],
    rules: {
      // Playwright names the callback that every fixture hands its value to
      // `use`, which this rule reads as a hook called outside a component.
      // The browser-automation suite renders no React of its own.
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);
