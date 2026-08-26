// tests/a11yProps.test.ts — react-native-web 0.21 builds a node's DOM props by
// picking from an explicit allow-list (modules/forwardedProps/index.js). That
// list has no `accessibilityState`, no `accessibilityHint` and no
// `accessibilityElementsHidden`, so a control declaring its state through them
// reaches the shipped platform with none of it. lib/a11y.tsx emits the `aria-*`
// twin alongside; this pins that every call site goes through it.
//
// Structural, like tests/reducedMotion.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const DROPPED_PROPS =
  /\b(accessibilityState|accessibilityHint|accessibilityElementsHidden|importantForAccessibility)=/;

function offendingLines(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => DROPPED_PROPS.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

test("no screen sets a prop react-native-web drops", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    for (const line of offendingLines(readFileSync(path.join(repoRoot, rel), "utf8"))) {
      offenders.push(`${rel}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these reach the web build as nothing: ${offenders.join(" | ")}. ` +
      `Use a11yState / a11yHint / a11yHidden from lib/a11y instead.`
  );
});

test("the scanner matches a real use", () => {
  assert.deepEqual(
    offendingLines('        accessibilityState={{ selected: true }}\n        accessibilityLabel="x"\n'),
    ["1: accessibilityState={{ selected: true }}"]
  );
});

// The helper is only worth having if it emits the web half. A version that
// returned the React Native props alone would pass the scan above and change
// nothing on the platform Replit serves.
test("a11yState emits the aria twin for the role it is given", async () => {
  const source = readFileSync(path.join(repoRoot, "lib/a11y.tsx"), "utf8");
  for (const aria of ["aria-disabled", "aria-busy", "aria-expanded", "aria-checked", "aria-selected", "aria-hidden", "aria-describedby"]) {
    assert.ok(source.includes(`"${aria}"`), `lib/a11y.tsx never emits ${aria}`);
  }
});

// A helper in lib/a11y returns props, so it has to be *called* before it is
// spread. `{...a11yHidden}` spreads the function itself, and a function has no
// enumerable properties, so the tag receives nothing at all: TypeScript allows
// it, ESLint allows it, the render looks identical, and the decorative node
// stays in the accessibility tree (#405).
//
// The names are taken by prefix rather than by return type, so a helper
// declared as an arrow const, or annotated some other way, cannot fall out of
// the set unnoticed — which is the same silence the scan exists to break.
const EXPORTED_HELPER = /export (?:function|const) (a11y\w+)/g;

function helperNames(a11ySource: string): string[] {
  return [...a11ySource.matchAll(EXPORTED_HELPER)].map(([, name]) => name);
}

function uncalledSpreads(source: string, names: string[]): string[] {
  // Whole-source rather than per-line: a spread broken over two lines is the
  // same defect. A `(` after the name is a call; `}` or `,` is the bare
  // function. `{...a11y}` and `{...a11y.props}` are local variables, not in
  // `names`, so they never reach this.
  const bare = new RegExp(String.raw`\{\s*\.\.\.\s*(?:${names.join("|")})\s*[,}]`, "g");
  const lines = source.split("\n");
  return [...source.matchAll(bare)].map((m) => {
    const n = source.slice(0, m.index).split("\n").length;
    return `${n}: ${lines[n - 1].trim()}`;
  });
}

const A11Y_HELPERS = helperNames(readFileSync(path.join(repoRoot, "lib/a11y.tsx"), "utf8"));

test("every prop helper lib/a11y exports is in the scanned set", () => {
  assert.deepEqual([...A11Y_HELPERS].sort(), ["a11yDialog", "a11yHidden", "a11yState", "a11yValue"]);
});

test("a helper is found whichever way it is declared", () => {
  assert.deepEqual(helperNames("export const a11yFoo = (): AccessibilityProps => ({});"), ["a11yFoo"]);
  assert.deepEqual(
    helperNames("export function a11yBar(cb: (x: number) => void): AccessibilityProps {}"),
    ["a11yBar"]
  );
});

test("the uncalled-spread scan catches the form that shipped", () => {
  // Verbatim components/SettingsModal.tsx:482 at 1177fb3, where it entered.
  const shipped =
    '              <Feather name="alert-circle" size={16} color={Colors.gold} {...a11yHidden} />';
  assert.deepEqual(uncalledSpreads(shipped, A11Y_HELPERS), [`1: ${shipped.trim()}`]);
});

test("the scan sees a spread however it is wrapped", () => {
  assert.deepEqual(uncalledSpreads("<Feather\n  {...\n  a11yHidden}\n/>", A11Y_HELPERS), ["2: {..."]);
  assert.deepEqual(uncalledSpreads("const p = { ...a11yState, foo: 1 };", A11Y_HELPERS), [
    "1: const p = { ...a11yState, foo: 1 };",
  ]);
});

test("a called helper, and a local variable named a11y, stay green", () => {
  const fine = [
    "<Feather {...a11yHidden()} />",
    '<Pressable {...a11yState({ role: "button", disabled })} />',
    "<Pressable {...a11y} />",
    "<Pressable {...a11y.props} />",
    "const { onPress, ...a11y } = props;",
  ].join("\n");
  assert.deepEqual(uncalledSpreads(fine, A11Y_HELPERS), []);
});

test("no screen spreads an a11y helper without calling it", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const line of uncalledSpreads(source, A11Y_HELPERS)) offenders.push(`${rel}:${line}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `spread of the function rather than its result, which contributes no props: ` +
      `${offenders.join(" | ")}. Call it: {...a11yHidden()}.`
  );
});

// The scan matches the helper's own name, so an alias would walk straight past
// it. Nothing aliases one today; this is what says so when that stops holding.
test("no screen imports an a11y helper under another name", () => {
  const aliased: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const [match] of source.matchAll(/\ba11y\w+\s+as\s+\w+/g)) aliased.push(`${rel}: ${match}`);
  }

  assert.deepEqual(
    aliased,
    [],
    `an aliased helper is invisible to the uncalled-spread scan: ${aliased.join(" | ")}`
  );
});
