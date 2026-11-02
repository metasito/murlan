// The rules `eslint-config-expo` gave this repo, wired directly so ESLint can be on 10
// (docs/adr/0017): eslint-plugin-import-x stands in for eslint-plugin-import, and the
// React version is read from the install because eslint-plugin-react's "detect" calls an API ESLint
// 10 removed. tests/tooling/eslintBase.test.ts plants a breach for every plugin rule here.
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const importX = require("eslint-plugin-import-x");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const expo = require("eslint-plugin-expo");
const globals = require("globals");

const JS = [".cjs", ".mjs", ".js", ".jsx"];
const TS = [".ts", ".tsx", ".d.ts"];
const EXTENSIONS = ["android", "ios", "web", "native", ""].flatMap((platform) =>
  [...JS, ...TS].map((ext) => (platform ? `.${platform}${ext}` : ext)),
);

// Metro's default assetExts plus json, the only `require` a Metro bundle resolves to a value.
const METRO_ASSET =
  "\\.(aac|aiff|avif|bmp|caf|db|gif|heic|html|jpeg|jpg|json|m4a|m4v|mov|mp3|mp4|mpeg|mpg|otf|pdf|png|psd|svg|ttf|wav|webm|webp|xml|yaml|yml|zip)$";

const UNUSED = { vars: "all", args: "none", ignoreRestSiblings: true, caughtErrors: "all" };

module.exports = [
  { ignores: ["android/app/build"] },
  { files: ["**/*.jsx"] },
  {
    plugins: { "import-x": importX, expo, react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { impliedStrict: true, jsx: true } },
      globals: {
        console: "readonly",
        exports: false,
        global: false,
        module: false,
        require: false,
        ...globals.browser,
        __DEV__: "readonly",
        ErrorUtils: false,
        FormData: false,
        XMLHttpRequest: false,
        alert: false,
        cancelAnimationFrame: false,
        cancelIdleCallback: false,
        clearImmediate: false,
        fetch: false,
        navigator: false,
        process: false,
        requestAnimationFrame: false,
        requestIdleCallback: false,
        setImmediate: false,
        window: false,
        "shared-node-browser": true,
      },
    },
    settings: {
      "import-x/ignore": ["node_modules[\\\\/]+@?react-native"],
      "import-x/extensions": EXTENSIONS,
      "import-x/parsers": { "@typescript-eslint/parser": TS },
      // eslint-plugin-import's resolver read a package's `module`, then `main`, never its
      // `exports`. Reading `exports` points `pg` and `bcryptjs` at ESM entries and raises 62 new
      // no-named-as-default-member warnings on code that has not changed.
      "import-x/resolver": { node: { extensions: EXTENSIONS, exportsFields: [] }, typescript: true },
      react: { version: require("react/package.json").version },
    },
    rules: {
      eqeqeq: ["warn", "smart"],
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty-character-class": "warn",
      "no-empty-pattern": "warn",
      "no-extend-native": "warn",
      "no-extra-bind": "warn",
      "no-redeclare": "warn",
      "no-undef": "error",
      "no-unreachable": "warn",
      "no-unsafe-negation": "warn",
      "no-unused-expressions": ["warn", { allowShortCircuit: true, enforceForJSX: true }],
      "no-unused-labels": "warn",
      "no-unused-vars": ["warn", { ...UNUSED, caughtErrorsIgnorePattern: "^_" }],
      "no-with": "warn",
      "unicode-bom": ["warn", "never"],
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-var": "error",

      "import-x/no-unresolved": "error",
      "import-x/namespace": "error",
      "import-x/export": "error",
      "import-x/no-named-as-default": "warn",
      "import-x/no-named-as-default-member": "warn",
      "import-x/no-duplicates": "warn",
      "import-x/first": "warn",

      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/no-unknown-property": "warn",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "react/no-this-in-sfc": "warn",

      "expo/use-dom-exports": "error",
      "expo/no-env-var-destructuring": "error",
      "expo/no-dynamic-env-var": "error",
    },
  },
  {
    files: TS.map((ext) => `**/*${ext}`),
    plugins: { "@typescript-eslint": tsPlugin },
    languageOptions: { parser: tsParser },
    rules: {
      "@typescript-eslint/array-type": ["warn", { default: "array" }],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/consistent-type-assertions": [
        "warn",
        { assertionStyle: "as", objectLiteralTypeAssertions: "allow" },
      ],
      "@typescript-eslint/no-extra-non-null-assertion": "warn",
      "no-dupe-class-members": "off",
      "@typescript-eslint/no-dupe-class-members": "error",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", UNUSED],
      "no-useless-constructor": "off",
      "@typescript-eslint/no-useless-constructor": "warn",
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": ["warn", { allow: [METRO_ASSET] }],
    },
  },
  {
    files: ["**/metro.config.js"],
    languageOptions: { globals: globals.node },
  },
];
