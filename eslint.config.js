const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// React Native renders an invalid colour as nothing at all — no warning, no
// fallback, just an invisible element. Every rule below targets a way to
// produce one that neither TypeScript nor a render test catches.
const TOKEN_OBJECTS = 'Colors|Spacing|Radius|FontSize|Type|Motion|Scrim|Highlight|Shadow|FeltGradient|FeltGradients|CardBacks';

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
    ],
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      // A wrong dependency array is a live-bug shape here, not a style nit —
      // it has shipped a stale closure twice (context/OnlineGameContext.tsx,
      // a round-winner banner). At the default "warn", `expo lint` still
      // exits 0, so the one check that would have caught either reports
      // nothing anyone sees. Every existing case that omits a real
      // dependency on purpose already carries its own
      // eslint-disable-next-line with a reason, which this does not affect.
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
          selector:
            "Property[key.name=/^(fontSize|borderRadius|padding|paddingVertical|paddingHorizontal|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap)$/] > Literal[raw=/^[1-9][0-9.]*$/]",
          message:
            "Use a FontSize, Radius or Spacing token. A one-off that fits no step may be a named module constant, but not a bare number in a style object.",
        },
      ],
    },
  },
]);
