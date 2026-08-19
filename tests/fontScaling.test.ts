// tests/fontScaling.test.ts — React Native multiplies every fontSize by the OS
// text setting, up to ~3.1x on iOS's Larger Accessibility Sizes, and leaves
// width, height and lineHeight alone.
//
// The table is built entirely from fixed boxes: CARD_W x CARD_H with
// overflow:"hidden", TOP_BAR_H, the avatar discs. At 200% the rank glyph is a
// 30px character in a 15px line box inside a card that does not grow. The
// menus scroll and are deliberately left fully scalable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// @ts-ignore
import { TABLE_FONT_SCALE_MAX } from "../lib/tokens.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every file that draws text inside the table's pinned geometry. */
const FIXED_GEOMETRY = [
  "components/CardView.tsx",
  "components/GameTable.tsx",
  // Derived rather than listed: a component moved into components/table/ stays scanned.
  ...readdirSync(path.join(repoRoot, "components", "table"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `components/table/${f.split(path.sep).join("/")}`),
];

const TEXT_TAG = /<(Text|Animated\.Text)(?=[\s>])([^>]*)/g;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** `line: tag` for every Text in `source` that will grow past its box. */
export function uncappedText(source: string): string[] {
  const out: string[] = [];
  // Prose that names a <Text> is not a <Text>. Blanking comments in place
  // keeps the line numbers the reader is given.
  const code = source.replace(COMMENT, (c) => c.replace(/[^\n]/g, " "));
  for (const m of code.matchAll(TEXT_TAG)) {
    if (m[2].includes("maxFontSizeMultiplier")) continue;
    out.push(`${code.slice(0, m.index).split("\n").length}: <${m[1]}>`);
  }
  return out;
}

test("capping degrades rather than refuses", () => {
  assert.ok(TABLE_FONT_SCALE_MAX > 1, "allowFontScaling={false} refuses the setting outright");
  assert.ok(TABLE_FONT_SCALE_MAX <= 1.5, "a cap this high puts the rank glyph back outside the card");
});

for (const rel of FIXED_GEOMETRY) {
  test(`every Text in ${rel} caps its scale`, () => {
    const offenders = uncappedText(readFileSync(path.join(repoRoot, rel), "utf8"));
    assert.deepEqual(offenders, [], `these grow past their fixed box:\n${offenders.join("\n")}`);
  });
}

test("the scanner matches a real use", () => {
  assert.deepEqual(uncappedText('  <Text style={styles.rankText}>\n'), ["1: <Text>"]);
  assert.deepEqual(uncappedText('  <Text maxFontSizeMultiplier={1.2} style={styles.x}>\n'), []);
  assert.deepEqual(uncappedText('  <TextInput value={v} />\n'), []);
});
