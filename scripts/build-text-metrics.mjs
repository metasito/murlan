/**
 * Writes components/table/textMetrics.generated.ts: the shaped width of every catalogue string a
 * table notice draws, in each locale, so the table's layout can know a notice's box before it
 * renders. A run whose words exist only at runtime is in `dynamic`, with the bound `noticeBox` puts
 * on it; tests/native/noticeText.test.tsx holds both to what the notices draw.
 *
 *   node scripts/build-text-metrics.mjs
 *
 * A run's width in points is `units / upem * fontSize + chars * tracking`, plus each slot's text,
 * which only render time knows and `faces[face].advances` prices glyph by glyph, plus whatever face draws each `fallback` codepoint: the served font
 * has no glyph for it, so its width is not known here and is not in `units`. Shaped against the
 * served WOFF2 subsets, which is what the web draws.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontverter from "fontverter";
import * as hb from "harfbuzzjs";
import { subsetCharacters, WEB_FONTS } from "./fontSubsetChars.mjs";
import { isInvokedDirectly } from "./lib/entry.mjs";
import { SUPPORTED_LOCALES, catalogs, templateParts } from "../shared/i18n.ts";
import { NOTICES, NOTICE_FACES, noticeBox, noticeRun } from "../components/table/noticeModel.ts";
import { RECONNECT_CODES } from "../components/table/connectionNote.ts";
import { CHIP_KEYS } from "../components/turnTimerUi.ts";
import { COMBO_NAME_KEYS } from "../lib/comboName.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "components", "table", "textMetrics.generated.ts");

/** The catalogue keys each notice kind draws, by the `noticeRun` role that sets them. */
export const TABLE_TEXT = {
  hudCombo: {
    text: [
      "gameShared.emptyTable",
      "exchange.pileGives",
      "exchange.pileYouGive",
      "exchange.pileGivesYou",
      "exchange.pillNothing",
      "exchangeAnnouncement.noExchangeText",
      "gameShared.you",
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
      ...RECONNECT_CODES.map((code) => `server.${code}`),
    ],
    key: ["common.retry"],
  },
  offline: { text: ["offlineBanner.text"] },
  whoStarts: {
    main: [
      "gameShared.startReasonCard",
      "gameShared.startReasonLostRound",
      "gameShared.startReasonWonNoExchange",
      "gameTable.startCardBannerSelf",
    ],
    sub: ["gameShared.startReasonCardSub", "gameShared.startReasonOneWaySub", "gameShared.startReasonOneWaySubYou"],
    hint: ["gameShared.startReasonDismiss"],
    disc: ["gameShared.you"],
  },
  leftTable: { main: ["onlineGame.leftTableTitle"], sub: ["onlineGame.leftTableBody"] },
  passed: { text: ["gameShared.passedLabel"] },
  reconnecting: { text: ["gameTable.seatReconnecting"] },
  vacated: { text: ["game.seatLeft"] },
  passFloat: { text: ["gameShared.passedLabel", "game.autoPassTitle"] },
  waitingOthers: { text: ["gameTable.waitingOthers"] },
  emptyHand: { text: ["gameShared.emptyHand"] },
  roundVote: { text: ["result.nextRound", "roundOverOverlay.nextRoundWaiting"] },
  endMatchVote: { text: ["game.endMatchVoteButton"] },
};

// Browsers drop optional ligatures from a letter-spaced run, and every notice is letter-spaced.
const SPACED = ["-liga", "-clig"];

export async function loadFont(bytes) {
  const face = new hb.Face(new hb.Blob(await fontverter.convert(bytes, "sfnt")));
  return { face, font: new hb.Font(face) };
}

/** Each glyph the run shapes to: the codepoint it starts at, its glyph id (0 when the face has none) and its advance. */
export function shapeRun(font, text, tabular) {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, [...SPACED, ...(tabular ? ["tnum"] : [])].map((f) => hb.Feature.fromString(f)));
  const codepoints = [...text];
  let unit = 0;
  const unitAt = new Map(codepoints.map((ch) => [(unit += ch.length) - ch.length, ch.codePointAt(0)]));
  return buffer.getGlyphInfosAndPositions().map((g) => ({ cp: unitAt.get(g.cluster), gid: g.codepoint, advance: g.xAdvance }));
}

const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * @param {{ root?: string, locales?: Record<string, Record<string, string>>, fontFile?: (family: string) => string }} [from]
 */
export async function textMetrics({
  root = ROOT,
  locales = catalogs,
  fontFile = (family) => path.join(root, "public", "fonts", `${family}.woff2`),
} = {}) {
  const chars = [...subsetCharacters(root)];
  const loaded = {};
  const faces = {};
  for (const [name, { fontFamily }] of Object.entries(NOTICE_FACES)) {
    if (!WEB_FONTS.some((f) => f.family === fontFamily)) throw new Error(`${fontFamily} is not one of scripts/fontSubsetChars.mjs's WEB_FONTS`);
    const { face, font } = await loadFont(readFileSync(fontFile(fontFamily)));
    loaded[name] = font;
    const advances = Object.fromEntries(
      chars.map((ch) => [ch, font.nominalGlyph(ch.codePointAt(0))]).filter(([, gid]) => gid).map(([ch, gid]) => [ch, font.glyphHAdvance(gid)])
    );
    const tabularDigit = Math.max(...shapeRun(font, "0123456789", true).map((g) => g.advance));
    faces[name] = { family: fontFamily, upem: face.upem, widestGlyph: Math.max(...Object.values(advances)), tabularDigit, advances };
  }
  const runs = {};
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = locales[locale];
    if (!catalog) throw new Error(`no catalogue for locale ${locale}`);
    runs[locale] = {};
    for (const [kind, roles] of Object.entries(TABLE_TEXT)) {
      runs[locale][kind] = {};
      for (const [role, keys] of Object.entries(roles)) {
        const set = noticeRun(noticeBox(kind, 1), role);
        for (const key of keys) {
          const template = catalog[key];
          if (typeof template !== "string") throw new Error(`locales/${locale}.ts has no "${key}", which the ${kind} notice draws`);
          const { runs: literal, slots } = templateParts(template);
          const cased = literal.filter((r) => r !== "").map((r) => (set.upper ? r.toLocaleUpperCase(locale) : r));
          const glyphs = cased.flatMap((r) => shapeRun(loaded[set.face], r, set.tabular));
          runs[locale][kind][`${role}:${key}`] = {
            face: set.face,
            upper: set.upper,
            tabular: set.tabular,
            units: glyphs.reduce((sum, g) => sum + (g.gid === 0 ? 0 : g.advance), 0),
            chars: cased.reduce((sum, r) => sum + [...r].length, 0),
            fallback: glyphs.filter((g) => g.gid === 0).map((g) => hex(g.cp)),
            slots,
          };
        }
      }
    }
  }
  const dynamic = {};
  for (const kind of Object.keys(NOTICES)) {
    const box = noticeBox(kind, 1);
    for (const [role, bound] of Object.entries(box.runtime)) (dynamic[kind] ??= {})[role] = { ...noticeRun(box, role), bound };
  }
  return { faces, runs, dynamic };
}

export function renderTextMetrics(metrics) {
  return `// Generated by \`node scripts/build-text-metrics.mjs\`; tests/tooling/textMetrics.test.ts holds it to the fonts, locales and renderers.\nexport const TEXT_METRICS = ${JSON.stringify(metrics, null, 2)} as const;\n`;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  writeFileSync(OUT, renderTextMetrics(await textMetrics()));
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
