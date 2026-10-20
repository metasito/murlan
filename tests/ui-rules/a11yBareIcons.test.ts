// tests/ui-rules/a11yBareIcons.test.ts — a glyph beside text is read aloud as its font
// character unless it is hidden or named. a11yOneNode.test.ts covers a glyph inside a
// labelled control; this covers the bare one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, jsxTags, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HIDDEN = /\.\.\.a11yHidden\(\s*(true\s*)?\)|accessibilityElementsHidden|aria-hidden/;
const NAMED = /accessibilityLabel=/;

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

test("every <Ionicons> outside an icon prop is hidden or labelled", () => {
  const offenders: string[] = [];
  for (const [file, raw] of sourcesUnder(repoRoot, ["app", "components"])) {
    const source = blankComments(raw);
    const spans = iconPropSpans(source);
    for (const tag of jsxTags(source)) {
      if (tag.name !== "Ionicons" || tag.isClose) continue;
      if (spans.some(([a, b]) => tag.start > a && tag.start < b)) continue;
      if (HIDDEN.test(tag.text) || NAMED.test(tag.text)) continue;
      const line = source.slice(0, tag.start).split("\n").length;
      offenders.push(`${file}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], "decorative glyphs need {...a11yHidden()}; meaningful ones an accessibilityLabel");
});
