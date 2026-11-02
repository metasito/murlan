import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const eslint = new ESLint({ cwd: ROOT });
const AT = "components/x.tsx";

const CLASS = (body: string) => `import React from "react";\nexport class A extends React.Component {\n${body}\n}\n`;

// eslint-plugin-react declares ESLint 9 at most and eslint-plugin-import-x replaced
// eslint-plugin-import: a rule that stopped reporting on ESLint 10 would pass lint silently.
const PLANTS: Record<string, string> = {
  "react/display-name": 'import React from "react";\nexport const A = React.memo(function () { return null; });\n',
  "react/jsx-key": "export const A = () => [1].map((n) => <div>{n}</div>);\n",
  "react/jsx-no-comment-textnodes": "export const A = () => <div>// note</div>;\n",
  "react/jsx-no-duplicate-props": "export const A = () => <div id=\"a\" id=\"b\" />;\n",
  "react/jsx-no-undef": "export const A = () => <Missing />;\n",
  "react/no-children-prop": "export const A = () => <div children=\"x\" />;\n",
  "react/no-danger-with-children": 'export const A = () => <div dangerouslySetInnerHTML={{ __html: "x" }}>y</div>;\n',
  "react/no-deprecated": CLASS("  componentWillMount() {}\n  render() { return null; }"),
  "react/no-direct-mutation-state": CLASS("  go() { this.state.a = 1; }\n  render() { return null; }"),
  "react/no-find-dom-node": 'import { findDOMNode } from "react-dom";\nexport const n = findDOMNode(null);\n',
  "react/no-is-mounted": CLASS("  go() { return this.isMounted(); }\n  render() { return null; }"),
  "react/no-render-return-value": 'import ReactDOM from "react-dom";\nexport const r = ReactDOM.render(<div />, null);\n',
  "react/no-string-refs": CLASS('  render() { return <div ref="box" />; }'),
  "react/no-this-in-sfc": "export function A() { return <div>{this.props.x}</div>; }\n",
  "react/no-unescaped-entities": "export const A = () => <div>don't</div>;\n",
  "react/no-unknown-property": 'export const A = () => <div class="x" />;\n',
  "react/require-render-return": CLASS("  render() { <div />; }"),
  "import-x/no-unresolved": 'import x from "./does-not-exist";\nexport default x;\n',
  "import-x/namespace": 'import * as theme from "@/lib/theme";\nexport const a = theme.NotAThing;\n',
  "import-x/export": "export const a = 1;\nexport { a };\n",
  "import-x/no-named-as-default": 'import z from "zod";\nexport default z;\n',
  "import-x/no-named-as-default-member":
    'import NotificationBanner from "@/components/NotificationBanner";\nexport const s = NotificationBanner.TOP_GAP;\n',
  "import-x/no-duplicates": 'import { Colors } from "@/lib/theme";\nimport { Spacing } from "@/lib/theme";\nexport { Colors, Spacing };\n',
  "import-x/first": 'export const a = 1;\nimport { Colors } from "@/lib/theme";\nexport { Colors };\n',
  "expo/use-dom-exports": '"use dom";\nexport const a = 1;\nexport default function A() { return null; }\n',
  "expo/no-env-var-destructuring": "export const { EXPO_PUBLIC_X } = process.env;\n",
  "expo/no-dynamic-env-var": 'const key = "EXPO_PUBLIC_X";\nexport const v = process.env[key];\n',
  "@typescript-eslint/array-type": "export const a: Array<number> = [];\n",
  "@typescript-eslint/no-unused-vars": "const unused = 1;\n",
  "@typescript-eslint/no-require-imports": 'export const m = require("./mod");\n',
};

// These two never report: they mark a JSX name as used, which the next test watches through no-unused-vars.
const MARKS_ONLY = ["react/jsx-uses-react", "react/jsx-uses-vars"];

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, AT) });
  assert.deepEqual(result!.messages.filter((m) => m.fatal), [], `not parsed: ${code}`);
  return result!.messages.map((m) => m.ruleId ?? "");
}

test("every react, import-x and expo rule the base enables has a plant", async () => {
  const config = (await eslint.calculateConfigForFile(path.join(ROOT, AT))) as { rules: Record<string, unknown> };
  const on = Object.entries(config.rules)
    .filter(([, v]) => (Array.isArray(v) ? v[0] : v) !== 0)
    .map(([k]) => k)
    .filter((k) => /^(react|import-x|expo)\//.test(k));
  const planted = Object.keys(PLANTS).filter((k) => /^(react|import-x|expo)\//.test(k));
  assert.deepEqual(on.sort(), [...planted, ...MARKS_ONLY].sort());
});

test("a component used only in JSX is not reported unused", async () => {
  const ids = await ruleIds('import { View } from "react-native";\nexport const A = () => <View />;\n');
  assert.ok(!ids.includes("@typescript-eslint/no-unused-vars"), ids.join(", "));
});

for (const [rule, code] of Object.entries(PLANTS)) {
  test(`${rule} still reports on ESLint 10`, async () => {
    assert.ok((await ruleIds(code)).includes(rule), `${rule} did not fire on:\n${code}`);
  });
}
