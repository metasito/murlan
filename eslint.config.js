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
      ],
    },
  },
]);
