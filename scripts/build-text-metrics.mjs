/**
 * Writes components/table/textMetrics.generated.ts: the harfbuzz-shaped width of every string a
 * table notice draws, in each locale, so the table's layout can know a notice's box before it
 * renders.
 *
 *   node scripts/build-text-metrics.mjs
 *
 * A run's width in points is `units / upem * fontSize + chars * tracking`, plus each slot's text,
 * which only render time knows. A slot holding a name is bounded by `widestGlyph` per character.
 * Native rasterisers round differently from harfbuzz, so this is the web's width, not the
 * device's. tests/tooling/textMetrics.test.ts re-shapes every run and fails on any difference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as hb from "harfbuzzjs";
import { subsetCharacters, WEB_FONTS } from "./fontSubsetChars.mjs";
import { isInvokedDirectly } from "./lib/entry.mjs";
import { SUPPORTED_LOCALES, catalogs, templateParts } from "../shared/i18n.ts";
import { NOTICE_FACES, noticeBox, noticeRun } from "../components/table/noticeModel.ts";
import { CHIP_KEYS } from "../components/turnTimerUi.ts";
import { COMBO_NAME_KEYS } from "../lib/comboName.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "components", "table", "textMetrics.generated.ts");
const require = createRequire(import.meta.url);

/** The words each table notice draws, by kind, as `NoticeText` (`text`) or its count (`strong`). */
export const TABLE_TEXT = {
  hudCombo: {
    text: [
      "gameShared.emptyTable",
      "exchange.pileGives",
      "exchange.pileYouGive",
      "exchange.pileGivesYou",
      "exchange.pillNothing",
      "exchangeAnnouncement.noExchangeText",
    ],
    strong: [...Object.values(COMBO_NAME_KEYS), "gameShared.comboMultiplier"],
  },
  turn: {
    text: [
      ...Object.values(CHIP_KEYS),
      "exchange.chipTitle",
      "exchange.chipGive",
      "exchange.chipOneWay",
      "exchange.chipOneWayYou",
      "exchange.waitingForYou",
      "exchange.watching",
      "offlineBanner.text",
      "onlineGame.connectionLost",
      "onlineGame.backOnline",
      "onlineGame.reconnecting",
    ],
  },
  passed: { text: ["gameShared.passedLabel"] },
  reconnecting: { text: ["gameTable.seatReconnecting"] },
  vacated: { text: ["game.seatLeft"] },
  roundVote: { text: ["result.nextRound", "roundOverOverlay.nextRoundWaiting"] },
  endMatchVote: { text: ["game.endMatchVoteButton"] },
};

// Browsers drop optional ligatures from a letter-spaced run, and every notice is letter-spaced.
const SPACED = ["-liga", "-clig"];

function loadFace(family) {
  const font = WEB_FONTS.find((f) => f.family === family);
  if (!font) throw new Error(`${family} is not one of scripts/fontSubsetChars.mjs's WEB_FONTS`);
  const face = new hb.Face(new hb.Blob(readFileSync(require.resolve(`${font.pkg}/${font.weight}/${font.family}.ttf`))));
  return { face, font: new hb.Font(face) };
}

function shape(font, text, tabular) {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, [...SPACED, ...(tabular ? ["tnum"] : [])].map((f) => hb.Feature.fromString(f)));
  const glyphs = buffer.getGlyphInfosAndPositions();
  return {
    units: glyphs.reduce((sum, g) => sum + (g.codepoint === 0 ? 0 : (g.xAdvance ?? 0)), 0),
    fallback: glyphs.filter((g) => g.codepoint === 0).length,
  };
}

/**
 * @param {{ root?: string, locales?: Record<string, Record<string, string>> }} [from]
 */
export function textMetrics({ root = ROOT, locales = catalogs } = {}) {
  const chars = [...subsetCharacters(root)];
  const loaded = {};
  const faces = {};
  for (const [name, { fontFamily }] of Object.entries(NOTICE_FACES)) {
    const { face, font } = loadFace(fontFamily);
    loaded[name] = font;
    const advances = chars.map((ch) => font.nominalGlyph(ch.codePointAt(0))).filter((gid) => gid).map((gid) => font.glyphHAdvance(gid));
    faces[name] = { family: fontFamily, upem: face.upem, widestGlyph: Math.max(...advances) };
  }
  const runs = {};
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = locales[locale];
    if (!catalog) throw new Error(`no catalogue for locale ${locale}`);
    runs[locale] = {};
    for (const [kind, roles] of Object.entries(TABLE_TEXT)) {
      runs[locale][kind] = {};
      for (const [role, keys] of Object.entries(roles)) {
        const set = noticeRun(noticeBox(kind, 1), role === "strong");
        for (const key of keys) {
          const template = catalog[key];
          if (typeof template !== "string") throw new Error(`locales/${locale}.ts has no "${key}", which the ${kind} notice draws`);
          const { runs: literal, slots } = templateParts(template);
          const cased = literal.filter((r) => r !== "").map((r) => (set.upper ? r.toLocaleUpperCase(locale) : r));
          const shaped = cased.map((r) => shape(loaded[set.face], r, set.tabular));
          runs[locale][kind][key] = {
            face: set.face,
            units: shaped.reduce((sum, s) => sum + s.units, 0),
            chars: cased.reduce((sum, r) => sum + [...r].length, 0),
            fallback: shaped.reduce((sum, s) => sum + s.fallback, 0),
            slots,
          };
        }
      }
    }
  }
  return { faces, runs };
}

export function renderTextMetrics(metrics) {
  return `// Generated by \`node scripts/build-text-metrics.mjs\`; tests/tooling/textMetrics.test.ts holds it to the fonts and locales.\nexport const TEXT_METRICS = ${JSON.stringify(metrics, null, 2)} as const;\n`;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  writeFileSync(OUT, renderTextMetrics(textMetrics()));
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
