// tests/ui-rules/a11yBareIcons.test.ts — a glyph beside text is read aloud as its font
// character unless it is hidden or named. a11yOneNode.test.ts covers a glyph inside a
// labelled control; this covers the bare one, and the receivers of an `icon={…}` prop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HIDDEN = /\.\.\.a11yHidden\(\s*(true\s*)?\)|accessibilityElementsHidden|aria-hidden/;
const NAMED = /accessibilityLabel=/;

/** Local names bound to an `@expo/vector-icons` family, aliases included. */
function iconNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/import\s+(\w+)\s+from\s+["']@expo\/vector-icons\/\w+["']/g)) names.add(m[1]);
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s+["']@expo\/vector-icons["']/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop();
      if (local) names.add(local);
    }
  }
  return names;
}

/** The spans of every `icon={…}` prop value, where the receiving component hides the glyph. */
function iconPropSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of source.matchAll(/\bicon=\{/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    spans.push([open, i]);
  }
  return spans;
}

/** Line numbers of every glyph that is neither in an `icon` prop, hidden, nor named. */
function bareIcons(raw: string): number[] {
  const source = blankComments(raw);
  const names = iconNames(source);
  const spans = iconPropSpans(source);
  const lines: number[] = [];
  for (const tag of jsxTags(source)) {
    if (!names.has(tag.name) || tag.isClose) continue;
    if (spans.some(([a, b]) => tag.start > a && tag.start < b)) continue;
    if (HIDDEN.test(tag.text) || NAMED.test(tag.text)) continue;
    lines.push(source.slice(0, tag.start).split("\n").length);
  }
  return lines;
}

/** Line numbers of every `{icon…}` rendered by a tag that does not hide it. */
function exposedIconSlots(raw: string): number[] {
  const source = blankComments(raw);
  const lines: number[] = [];
  const open: { name: string; text: string }[] = [];
  const tags = jsxTags(source);
  for (const m of source.matchAll(/(?<!=)\{icon\}/g)) {
    open.length = 0;
    for (const tag of tags) {
      if (tag.start > m.index) break;
      if (tag.isClose) {
        const at = open.map((o) => o.name).lastIndexOf(tag.name);
        if (at >= 0) open.length = at;
      } else if (!tag.selfClose) open.push({ name: tag.name, text: tag.text });
    }
    if (!open.some((o) => HIDDEN.test(o.text))) lines.push(source.slice(0, m.index).split("\n").length);
  }
  return lines;
}

test("the predicate flags a bare glyph of any family, aliased or not", () => {
  const bare = (head: string, tag: string) => bareIcons(`${head}\nconst A = () => ${tag};`);
  assert.deepEqual(bare('import Ionicons from "@expo/vector-icons/Ionicons";', '<Ionicons name="x" />'), [2]);
  assert.deepEqual(bare('import Feather from "@expo/vector-icons/Feather";', '<Feather name="x" />'), [2]);
  assert.deepEqual(bare('import { Ionicons as Glyph } from "@expo/vector-icons";', '<Glyph name="x" />'), [2]);
  assert.deepEqual(bare('import Icon from "@expo/vector-icons/MaterialIcons";', '<Icon name="x" />'), [2]);
});

test("the predicate passes a hidden, labelled or icon-prop glyph", () => {
  const head = 'import Ionicons from "@expo/vector-icons/Ionicons";';
  const ok = (tag: string) => assert.deepEqual(bareIcons(`${head}\nconst A = () => ${tag};`), []);
  ok('<Ionicons name="x" {...a11yHidden()} />');
  ok('<Ionicons name="x" accessibilityLabel="Trophy" />');
  ok('<Button icon={<Ionicons name="x" />} />');
});

test("the receiver check flags a slot that does not hide its icon", () => {
  assert.deepEqual(exposedIconSlots("const A = () => <View>{icon}</View>;"), [1]);
  assert.deepEqual(exposedIconSlots("const A = () => <View {...a11yHidden()}>{icon}</View>;"), []);
});

test("every glyph outside an icon prop is hidden or labelled", () => {
  const offenders: string[] = [];
  for (const [file, raw] of sourcesUnder(repoRoot, ["app", "components"])) {
    for (const line of bareIcons(raw)) offenders.push(`${file}:${line}`);
  }
  assert.deepEqual(offenders, [], "decorative glyphs need {...a11yHidden()}; meaningful ones an accessibilityLabel");
});

test("every component that renders an icon prop hides it", () => {
  const offenders: string[] = [];
  for (const [file, raw] of sourcesUnder(repoRoot, ["app", "components"])) {
    for (const line of exposedIconSlots(raw)) offenders.push(`${file}:${line}`);
  }
  assert.deepEqual(offenders, [], "the receiver of icon={…} must wrap it in a11yHidden()");
});
