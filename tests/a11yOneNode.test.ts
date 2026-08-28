// tests/a11yOneNode.test.ts — a labelled control's own face is not a second
// stop for a reader.
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
const HIDDEN = /\.\.\.a11yHidden\(|accessibilityElementsHidden|aria-hidden|\.\.\.a11yVeiled\(/;
const LABELLED = /accessibilityLabel=/;

/**
 * Controls whose child must stay reachable, with the reason. Short by design:
 * nearly every candidate is the same defect with the same one-prop fix, so a
 * long list here would be bugs wearing the costume of decisions.
 */
const DELIBERATELY_REACHABLE: [string, number, string][] = [
  [
    "components/ExchangeAnnouncement.tsx",
    1,
    "the announcement panel is itself the labelled node, and it holds both its own copy and a close button — hiding its subtree erases the panel and the only way out of it (#495)",
  ],
  [
    "components/NotificationBanner.tsx",
    1,
    "the banner's body is a live region, and a live region announces the text that changes inside it rather than its own label — hide the copy and every notification arrives silently on web (#495)",
  ],
];

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
 * `line: <Tag> -> Text@line, Ionicons@line` for every labelled control still
 * exposing part of its own face.
 *
 * A nested control is skipped whole: its contents belong to it, and hiding
 * them would take the control with them.
 */
export function reachableChildren(source: string): string[] {
  const src = blankComments(source);
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const tags = jsxTags(src);
  const out: string[] = [];

  for (let k = 0; k < tags.length; k++) {
    const control = tags[k];
    if (control.isClose || control.selfClose) continue;
    if (!INTERACTIVE.test(control.name) || !LABELLED.test(control.text)) continue;
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
      if (!skipping && FACE.test(child.name) && !HIDDEN.test(child.text) && hiddenAt.length === 0) {
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

test("a nested control keeps its own contents", () => {
  assert.deepEqual(
    reachableChildren(
      "<Pressable accessibilityLabel={x}>\n  <Pressable accessibilityLabel={y}>\n    <Text>hi</Text>\n  </Pressable>\n</Pressable>"
    ),
    ["2: <Pressable> -> Text@3"]
  );
});

test("no labelled control leaves its own face reachable", () => {
  const allowed = new Map<string, number>();
  for (const [file, count] of DELIBERATELY_REACHABLE) {
    allowed.set(file, (allowed.get(file) ?? 0) + count);
  }

  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const hits = reachableChildren(readFileSync(path.join(repoRoot, rel), "utf8"));
    const spare = allowed.get(rel) ?? 0;
    offenders.push(...hits.slice(spare).map((hit) => `${rel}:${hit}`));
  }

  assert.deepEqual(
    offenders,
    [],
    "hide each control's own face with {...a11yHidden()} — on the child, or on the " +
      `one wrapper that already holds several:\n  ${offenders.join("\n  ")}`
  );
});
