// tests/fontScaling.test.ts — React Native multiplies every fontSize by the OS
// text setting, up to ~3.1x on iOS's Larger Accessibility Sizes, and leaves
// width, height and lineHeight alone.
//
// The table is built entirely from fixed boxes: CARD_W x CARD_H with
// overflow:"hidden", TOP_BAR_H, the avatar discs. At 200% the rank glyph is a
// 30px character in a 15px line box inside a card that does not grow. The
// menus scroll and are deliberately left fully scalable.
//
// components/table/TableText.tsx holds the cap, so a table file cannot render
// uncapped text by forgetting a prop — it would have to import bare Text. That
// is what this scan refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TABLE_FONT_SCALE_MAX } from "../lib/tokens.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one component allowed to render a Text inside the table's geometry. */
const CAP = "components/table/TableText.tsx";

/** Every file that draws text inside the table's pinned geometry. */
const FIXED_GEOMETRY = [
  "components/CardView.tsx",
  "components/GameTable.tsx",
  ...readdirSync(path.join(repoRoot, "components", "table"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `components/table/${f.split(path.sep).join("/")}`),
].filter((rel) => rel !== CAP);

const TEXT_TAG = /<(Text|Animated\.Text)(?=[\s>])/g;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** `line: tag` for every bare Text in `source`, capped or not. */
export function bareText(source: string): string[] {
  const out: string[] = [];
  // Prose that names a <Text> is not a <Text>. Blanking comments in place
  // keeps the line numbers the reader is given.
  const code = source.replace(COMMENT, (c) => c.replace(/[^\n]/g, " "));
  for (const m of code.matchAll(TEXT_TAG)) {
    out.push(`${code.slice(0, m.index).split("\n").length}: <${m[1]}>`);
  }
  return out;
}

test("capping degrades rather than refuses", () => {
  assert.ok(TABLE_FONT_SCALE_MAX > 1, "allowFontScaling={false} refuses the setting outright");
  assert.ok(TABLE_FONT_SCALE_MAX <= 1.5, "a cap this high puts the rank glyph back outside the card");
});

test("the cap is written in one component, not copied onto each Text", () => {
  const setters = [CAP, ...FIXED_GEOMETRY].filter((rel) =>
    readFileSync(path.join(repoRoot, rel), "utf8").includes("maxFontSizeMultiplier")
  );
  assert.deepEqual(setters, [CAP]);
});

test("TableText caps after the spread, so a caller cannot pass a larger multiplier", () => {
  const source = readFileSync(path.join(repoRoot, CAP), "utf8");
  for (const m of source.matchAll(/\{\.\.\.props\}([^>]*)/g)) {
    assert.match(m[1], /maxFontSizeMultiplier=\{TABLE_FONT_SCALE_MAX\}/);
  }
  assert.equal([...source.matchAll(/\{\.\.\.props\}/g)].length, 2);
});

for (const rel of FIXED_GEOMETRY) {
  test(`${rel} renders no bare Text`, () => {
    const offenders = bareText(readFileSync(path.join(repoRoot, rel), "utf8"));
    assert.deepEqual(
      offenders,
      [],
      `these can grow past their fixed box — use TableText:\n${offenders.join("\n")}`
    );
  });
}

test("the scanner matches a real use", () => {
  assert.deepEqual(bareText('  <Text style={styles.rankText}>\n'), ["1: <Text>"]);
  // The prop is no longer an escape hatch: a bare Text is an offender either way.
  assert.deepEqual(bareText('  <Text maxFontSizeMultiplier={1.2} style={styles.x}>\n'), ["1: <Text>"]);
  assert.deepEqual(bareText('  <Animated.Text style={s}>x</Animated.Text>\n'), ["1: <Animated.Text>"]);
  assert.deepEqual(bareText('  <TableText style={styles.x}>\n'), []);
  assert.deepEqual(bareText('  <TextInput value={v} />\n'), []);
});
