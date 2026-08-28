// tests/a11yOneNode.test.ts — a labelled control's own face is not a second
// stop for a reader, and neither is a grouped container's.
//
// `Pressable` defaults `accessible` to true. On iOS that is the whole story:
// it becomes `isAccessibilityElement` (RCTViewComponentView.mm), and such a
// view is a UIKit leaf. react-native-web forwards the prop nowhere, so on web
// the control is a `div[role=…][aria-label]` with its children fully live
// beneath it — Chromium's own tree lists them as named nodes under a node that
// is already named.
//
// This reads props, so it can only say a child is *declared* hidden.
// `tests/e2e/oneAccessibleNode.spec.ts` reads what the browser built from them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INTERACTIVE = /^(Animated\.)?(Pressable|Touchable[A-Za-z]*)$/;
/** What a control draws itself with: words and glyphs, never layout. */
const FACE = /^(Text|Ionicons|MaterialIcons|MaterialCommunityIcons|Feather|AntDesign|FontAwesome\d*)$/;

/**
 * Components that are a face under another name. `TableText` is one line —
 * `<Text {...props} maxFontSizeMultiplier={…} />` — and a scan that matches tag
 * names alone cannot see through it, so the whole game table reads as clean.
 * The next such wrapper is found by being one, not by being listed here.
 */
function faceAliases(read: (rel: string) => string, files: string[]): Set<string> {
  const returns = new Map<string, string>();
  for (const rel of files) {
    const source = blankComments(read(rel));
    for (const decl of source.matchAll(/export function (\w+)\s*\(/g)) {
      const returned = /return\s*\(?\s*<([A-Za-z][\w.]*)/.exec(source.slice(decl.index));
      if (returned) returns.set(decl[1], returned[1]);
    }
  }

  // To a fixed point, because an alias can wrap an alias: `ChipText` returns a
  // `TableText`, which returns a `Text`. One pass finds `TableText` and reports
  // the game table clean.
  const out = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, returned] of returns) {
      if (out.has(name) || !(FACE.test(returned) || out.has(returned))) continue;
      out.add(name);
      grew = true;
    }
  }
  return out;
}
// Unconditionally hidden only. `a11yHidden(decorative)` hides on some renders
// and not others, and the renders it does not cover are the defect.
const HIDDEN = /\.\.\.a11yHidden\(\s*(true\s*)?\)|accessibilityElementsHidden|aria-hidden/;
const LABELLED = /accessibilityLabel=/;

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/**
 * `line: <Tag> -> Text@line, Ionicons@line` for every labelled control or
 * grouped container still exposing part of its own face.
 *
 * A nested control is skipped whole: its contents belong to it, and hiding
 * them would take the control with them.
 */
export function reachableChildren(source: string, aliases: Set<string> = new Set()): string[] {
  const isFace = (name: string) => FACE.test(name) || aliases.has(name);
  const src = blankComments(source);
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const tags = jsxTags(src);
  const out: string[] = [];

  for (let k = 0; k < tags.length; k++) {
    const control = tags[k];
    if (control.isClose || control.selfClose) continue;
    // A grouped container is one node for the same reason a control is, so its
    // contents are its face too — `a11yGroup` carries the label as an argument
    // rather than as a prop, which is why it is not `LABELLED` that decides.
    const named = INTERACTIVE.test(control.name)
      ? LABELLED.test(control.text)
      : GROUPING.test(control.text);
    if (!named) continue;
    if (HIDDEN.test(control.text)) continue;

    let depth = 0;
    const hiddenAt: number[] = [];
    let skipBelow: number | null = null;
    const exposed: string[] = [];

    for (let j = k + 1; j < tags.length; j++) {
      const child = tags[j];
      if (child.isClose) {
        if (depth === 0) break;
        depth -= 1;
        while (hiddenAt.length && hiddenAt[hiddenAt.length - 1] >= depth) hiddenAt.pop();
        if (skipBelow !== null && depth <= skipBelow) skipBelow = null;
        continue;
      }
      const skipping = skipBelow !== null;
      if (!skipping && isFace(child.name) && !HIDDEN.test(child.text) && hiddenAt.length === 0) {
        exposed.push(`${child.name}@${lineAt(child.start)}`);
      }
      if (child.selfClose) continue;
      if (!skipping && INTERACTIVE.test(child.name)) skipBelow = depth;
      if (HIDDEN.test(child.text)) hiddenAt.push(depth);
      depth += 1;
    }

    if (exposed.length) {
      out.push(`${lineAt(control.start)}: <${control.name}> -> ${exposed.join(", ")}`);
    }
  }
  return out;
}

/** A container that speaks as one node, however it is written. */
const GROUPING = /(?:^|\s)accessible(?=[\s>]|$|=\{true\})|a11yGroup\(/;

/**
 * `line: <Tag> -> Pressable@line` for every grouped container holding a
 * control. On iOS the container is one leaf and the control inside it is
 * reachable by nobody, which no amount of hiding can fix.
 */
export function sealedControls(source: string): string[] {
  const src = blankComments(source);
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const tags = jsxTags(src);
  const out: string[] = [];

  for (let k = 0; k < tags.length; k++) {
    const container = tags[k];
    if (container.isClose || container.selfClose) continue;
    if (INTERACTIVE.test(container.name) || !GROUPING.test(container.text)) continue;

    let depth = 0;
    const sealed: string[] = [];
    for (let j = k + 1; j < tags.length; j++) {
      const child = tags[j];
      if (child.isClose) {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (INTERACTIVE.test(child.name)) sealed.push(`${child.name}@${lineAt(child.start)}`);
      if (!child.selfClose) depth += 1;
    }
    if (sealed.length) {
      out.push(`${lineAt(container.start)}: <${container.name}> -> ${sealed.join(", ")}`);
    }
  }
  return out;
}

test("the tokeniser reads names, closers and self-closers in order", () => {
  assert.deepEqual(
    jsxTags("<View a={{x:1}}>\n  <Text />\n</View>").map(
      (t) => `${t.isClose ? "/" : ""}${t.name}${t.selfClose ? "/" : ""}`
    ),
    ["View", "Text/", "/View"]
  );
  assert.match(
    jsxTags('<Pressable style={{ w: a > b }} accessibilityLabel="x">')[0].text,
    /accessibilityLabel="x"/
  );
});

// An unbalanced brace inside a quoted attribute value used to leave the count
// negative, so the tag ran on to a later `>` and absorbed its own children.
test("a brace inside a string does not extend the tag over its children", () => {
  assert.deepEqual(
    reachableChildren('<Pressable accessibilityLabel={x} title="a } b">\n  <Text>hi</Text>\n</Pressable>'),
    ["1: <Pressable> -> Text@2"]
  );
});

test("a reachable child is reported, by tag and line", () => {
  assert.deepEqual(
    reachableChildren("<Pressable accessibilityLabel={x}>\n  <Text>hi</Text>\n</Pressable>"),
    ["1: <Pressable> -> Text@2"]
  );
});

test("hidden at the child, or at a wrapper, is hidden either way", () => {
  assert.deepEqual(
    reachableChildren(
      "<Pressable accessibilityLabel={x}>\n  <Text {...a11yHidden()}>hi</Text>\n</Pressable>"
    ),
    []
  );
  assert.deepEqual(
    reachableChildren(
      "<Pressable accessibilityLabel={x}>\n  <View {...a11yHidden()}>\n    <Text>hi</Text>\n  </View>\n</Pressable>"
    ),
    []
  );
});

// The wrapper's cover ends where the wrapper does. A walk that pops one level
// late reads everything after a hidden sibling as hidden too, and reports a
// clean file.
test("a wrapper hides what it holds and nothing after it", () => {
  assert.deepEqual(
    reachableChildren(
      "<Pressable accessibilityLabel={x}>\n  <View {...a11yHidden()}>\n    <Text>a</Text>\n  </View>\n  <Text>b</Text>\n</Pressable>"
    ),
    ["1: <Pressable> -> Text@5"]
  );
});

// The rule reaches a container through `a11yGroup`, which carries the label as
// an argument — so nothing in the tag says `accessibilityLabel`, and a scan
// keyed on that prop reports the whole game table clean.
test("a grouped container's own face is reported too", () => {
  assert.deepEqual(
    reachableChildren('<View {...a11yGroup(x)}>\n  <Text>leaky</Text>\n</View>'),
    ["1: <View> -> Text@2"]
  );
  assert.deepEqual(
    reachableChildren('<View {...a11yGroup(x)}>\n  <Text {...a11yHidden()}>a</Text>\n</View>'),
    []
  );
});

// One alias may wrap another: `ChipText` returns a `TableText`, which returns a
// `Text`. Resolving a single level reports the game table clean.
test("a face alias is resolved through another alias", () => {
  const aliases = faceAliases(
    (rel) =>
      rel === "a"
        ? "export function TableText(p) {\n  return <Text {...p} />;\n}"
        : "export function ChipText(p) {\n  return <TableText {...p} />;\n}",
    ["a", "b"]
  );
  assert.deepEqual([...aliases].sort(), ["ChipText", "TableText"]);
});

test("a nested control keeps its own contents", () => {
  assert.deepEqual(
    reachableChildren(
      "<Pressable accessibilityLabel={x}>\n  <Pressable accessibilityLabel={y}>\n    <Text>hi</Text>\n  </Pressable>\n</Pressable>"
    ),
    ["2: <Pressable> -> Text@3"]
  );
});

test("an accessible container reports the control it seals", () => {
  assert.deepEqual(
    sealedControls(
      '<View accessible accessibilityLabel={x}>\n  <Text>a</Text>\n  <Pressable onPress={f} />\n</View>'
    ),
    ["1: <View> -> Pressable@3"]
  );
  assert.deepEqual(
    sealedControls('<View {...a11yGroup(x)}>\n  <Pressable onPress={f} />\n</View>'),
    ["1: <View> -> Pressable@2"]
  );
});

// The floor. A grouped container with no control inside is the ordinary case,
// and a rule that fired on it would be one nobody could satisfy.
test("a grouped container with no control inside is clean", () => {
  assert.deepEqual(
    sealedControls('<View accessible accessibilityLabel={x}>\n  <Text>a</Text>\n</View>'),
    []
  );
});

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const scanned = () => [...sourcesUnder("app"), ...sourcesUnder("components")];

test("no grouped container seals a control", () => {
  const offenders: string[] = [];
  for (const rel of scanned()) {
    for (const hit of sealedControls(read(rel))) offenders.push(`${rel}:${hit}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "`accessible` makes the view a UIKit leaf, so a control inside it cannot be reached " +
      `on iOS at all — drop the grouping, or move the control out:\n  ${offenders.join("\n  ")}`
  );
});

// No exception list: the one control that looked like it needed one was a
// live region wearing a button's clothes, and the answer was a node of its
// own (`lib/a11y.tsx`'s `A11yStatus`) rather than a licence.
test("no labelled control leaves its own face reachable", () => {
  const aliases = faceAliases(read, scanned());

  const offenders: string[] = [];
  for (const rel of scanned()) {
    for (const hit of reachableChildren(read(rel), aliases)) {
      offenders.push(`${rel}:${hit}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "hide each control's own face with {...a11yHidden()} — on the child, or on the " +
      `one wrapper that already holds several:\n  ${offenders.join("\n  ")}`
  );
});
