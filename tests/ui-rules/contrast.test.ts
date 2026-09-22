// WCAG 2.x contrast audit for lib/theme.ts text colors. Palette-wide tokens
// are measured against bg, bgCard and the felt's middle stop; every style that
// draws inside the table is measured against every stop of every felt, which
// is the only place the gradient's 2x luminance range can be seen.
//
// This exists so a future palette edit can't silently regress accessibility —
// see lib/theme.ts "Text colors" section.
//
// Imports lib/tokens — the same palette — not lib/theme, whose Shadow helper pulls
// react-native in; that and the extension — docs/agents/loops.md, "Node's TypeScript loader".
import { Colors, Garnet, Gradient, Scrim, FeltGradients, Type } from "../../lib/tokens.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// --- WCAG 2.x contrast math -------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two opaque hex colors, 1:1 to 21:1. */
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Flattens `rgba(r,g,b,a)` (as used by several Colors entries) onto an opaque
 *  hex background, returning the resulting opaque hex — this is what actually
 *  reaches the screen once React Native composites the color. */
function flattenRgba(rgba: string, bgHex: string): string {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`Not an rgba() string: ${rgba}`);
  const [, r, g, b, a] = m;
  const alpha = parseFloat(a);
  const [br, bg, bb] = hexToRgb(bgHex);
  const flat: [number, number, number] = [
    Math.round(Number(r) * alpha + br * (1 - alpha)),
    Math.round(Number(g) * alpha + bg * (1 - alpha)),
    Math.round(Number(b) * alpha + bb * (1 - alpha)),
  ];
  return "#" + flat.map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Resolves any Colors.* value (solid hex or rgba string) to an opaque hex,
 *  as actually composited over the given background. */
function resolve(color: string, bgHex: string): string {
  return color.startsWith("rgba(") ? flattenRgba(color, bgHex) : color;
}

const BODY_MIN = 4.5; // WCAG AA, normal text
const LARGE_MIN = 3.0; // WCAG AA, large (>=18pt or >=14pt bold) text

const SURFACES = {
  bg: Colors.bg,
  bgCard: Colors.bgCard,
  felt: Colors.felt,
} as const;

// --- The felt is a gradient, and Colors.felt is only its middle stop --------
// components/table/felt.tsx lays the five stops along the lamp's own falloff.
// The cloth directly under the lamp is several times the relative luminance of
// the stop this file used to measure, so a token could pass here at 4.60 and
// render at 3.43 where it is actually drawn.
//
// Both colours are read out of the table's own components rather than repeated
// here, so a plate that is removed from a style is a failure rather than a
// silent pass against a fill nothing paints.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PALETTES: Record<string, Record<string, string>> = { Colors, Scrim, Garnet };

const COMPONENT_FILES: [string, string][] = readdirSync(path.join(repoRoot, "components"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f.split(path.sep).join("/"), readFileSync(path.join(repoRoot, "components", f), "utf8")]);
const COMPONENTS = COMPONENT_FILES.map(([, src]) => src).join("\n");

/** From an opening bracket at `at` to its matching closer, inclusive. */
function balanced(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if ("{[(".includes(src[i])) depth++;
    else if ("}])".includes(src[i]) && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced from ${at}`);
}

/**
 * `sheet.key`'s body as written. `styles` is file-local, so it is looked up in
 * the call site's own file; a named sheet may be exported from another.
 */
function styleEntry(file: string, ref: string): string {
  const [sheet, key] = ref.split(".");
  const files = sheet === "styles" ? COMPONENT_FILES.filter(([f]) => f === file) : COMPONENT_FILES;
  const defs = files.flatMap(([, src]) => {
    const at = src.search(new RegExp(String.raw`\bconst ${sheet} = StyleSheet\.create\(`));
    return at === -1 ? [] : [balanced(src, src.indexOf("{", at))];
  });
  assert.equal(defs.length, 1, `${file}: ${sheet} is declared ${defs.length} times`);
  const m = new RegExp(String.raw`\n\s*${key}: \{`).exec(defs[0]);
  assert.ok(m, `${file}: ${ref} is not declared`);
  return balanced(defs[0], m.index + m[0].length - 1);
}

const COLOUR = String.raw`([A-Za-z]+\.[A-Za-z]+|"[^"]+"|'[^']+')`;

function colourValue(written: string): string {
  if (/^["']/.test(written)) return written.slice(1, -1);
  const [ns, key] = written.split(".");
  const val = PALETTES[ns]?.[key];
  assert.ok(val, `unresolved colour ${written}`);
  return val;
}

/** A style's `backgroundColor`, resolved. */
function styleFill(file: string, ref: string): string | null {
  const m = new RegExp(String.raw`\bbackgroundColor: ${COLOUR}`).exec(styleEntry(file, ref));
  return m ? colourValue(m[1]) : null;
}

/** A style's ink with its own `opacity` folded in, or null for a style that sets neither. */
function styleInk(file: string, ref: string): string | null {
  const body = styleEntry(file, ref);
  const own = new RegExp(String.raw`(?<![A-Za-z])color: ${COLOUR}`).exec(body);
  const typed = /\.\.\.Type\.(\w+)/.exec(body);
  const ink = own ? colourValue(own[1]) : typed ? (Type as Record<string, { color?: string }>)[typed[1]]?.color : undefined;
  const opacity = /\bopacity: ([\d.]+)/.exec(body);
  if (!ink) {
    assert.ok(!opacity, `${file}: ${ref} sets an opacity but no colour`);
    return null;
  }
  return opacity ? withOpacity(ink, Number(opacity[1])) : ink;
}

function withOpacity(color: string, opacity: number): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(color);
  const [r, g, b] = m ? [m[1], m[2], m[3]].map(Number) : hexToRgb(color);
  return `rgba(${r},${g},${b},${(m ? Number(m[4]) : 1) * opacity})`;
}

function openingTag(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    else if (src[i] === ">" && depth === 0) return src.slice(at, i);
  }
  throw new Error(`unclosed tag at ${at}`);
}

/** `[file, sheet.key]` for every style a `<TableText>` element names. */
function tableTextStyles(): [string, string][] {
  const out = new Map<string, [string, string]>();
  for (const [file, src] of COMPONENT_FILES) {
    for (const m of src.matchAll(/<TableText\b/g)) {
      const tag = openingTag(src, m.index);
      const style = /\bstyle=\{/.exec(tag);
      if (!style) continue;
      const expr = balanced(tag, style.index + style[0].length - 1);
      for (const ref of expr.matchAll(/\b(\w*[sS]tyles)\.(\w+)/g)) {
        out.set(`${file}:${ref[1]}.${ref[2]}`, [file, `${ref[1]}.${ref[2]}`]);
      }
    }
  }
  return [...out.values()];
}

/**
 * A `NAME = [ ... ]` array literal declared in component source — a pressed
 * gradient's own stops — resolved to token values. A stop a component adds is
 * covered by construction; nothing here needs to be told about it.
 */
function sourceArray(name: string): string[] {
  const m = new RegExp(String.raw`\b${name}\s*=\s*\[([^\]]*)\]`).exec(COMPONENTS);
  assert.ok(m, `no component declares an array named ${name}`);
  // A stop is either a token reference (Colors.gold) or a raw literal
  // ("#6B5220") slipped in directly — both must be caught, since the second
  // is exactly the shape of a stop nobody meant to leave unresolved.
  const items = m[1].match(/[A-Za-z]+\.[A-Za-z]+|"[^"]+"|'[^']+'/g) ?? [];
  assert.ok(items.length > 0, `${name} has no gradient stops`);
  return items.map((item) => {
    if (item.startsWith('"') || item.startsWith("'")) return item.slice(1, -1);
    const [ns, key] = item.split(".");
    const val = PALETTES[ns]?.[key];
    assert.ok(val, `${name}: unresolved token ${item}`);
    return val;
  });
}

/** Which falloff stops an element can sit over. */
const ANY_STOP = [0, 1, 2, 3, 4];

/**
 * What each inked `<TableText>` style is painted over, keyed `file:sheet.key`.
 * `plate` is a style whose fill sits between it and the felt; `gradient` is a
 * fill given as `colors`, which no style can name. Neither means bare felt.
 */
type Backdrop = { plate?: string | string[]; gradient?: readonly string[]; stops?: number[] };
const SELF = "self";
const GIOCA = [...Gradient.playButton, ...sourceArray("GIOCA_GRADIENT_PRESSED")];
const PASSA = [...Gradient.garnet, ...sourceArray("PASS_GRADIENT_PRESSED")];
const SHEET = sourceArray("SHEET_GRADIENT");
const START_REASON = { plate: "startReasonStyles.card" };
const CHIP = { plate: "chipStyles.chip" };
const REMATCH = { plate: "styles.rematchPanel" };
const ON_TABLE: Record<string, Backdrop> = {
  "ExchangeAnnouncement.tsx:styles.noSwap": { plate: SELF },
  "GameTable.tsx:styles.finishedText": { plate: SELF },
  "GameTable.tsx:styles.rejectHintText": { plate: SELF },
  "table/actions.tsx:styles.playBtnLabel": { gradient: GIOCA },
  "table/actions.tsx:styles.playBtnSub": { gradient: GIOCA },
  // PASSA's dim fill is a sibling of its label, not an ancestor; both buttons draw the same one.
  "table/actions.tsx:styles.btnDimLabel": { plate: "styles.btnDimFace" },
  "table/actions.tsx:styles.passBtnLabel": { gradient: PASSA },
  "table/chrome.tsx:startReasonStyles.eyebrow": START_REASON,
  "table/chrome.tsx:startReasonStyles.main": START_REASON,
  "table/chrome.tsx:startReasonStyles.sub": START_REASON,
  "table/chrome.tsx:startReasonStyles.hint": START_REASON,
  "table/chrome.tsx:chipStyles.chipLabel": CHIP,
  "table/chrome.tsx:chipStyles.chipLabelStrong": CHIP,
  "table/chrome.tsx:chipStyles.chipLabelLit": CHIP,
  "table/chrome.tsx:chipStyles.chipLabelUrgent": CHIP,
  "table/chrome.tsx:startCardStyles.glyph": { plate: "startCardStyles.banner" },
  "table/chrome.tsx:startCardStyles.text": { plate: "startCardStyles.banner" },
  "table/ExchangeFlight.tsx:styles.tag": { plate: SELF },
  "table/ExchangePrompt.tsx:styles.line": { plate: SELF },
  "table/ExchangePrompt.tsx:styles.rule": { plate: SELF },
  "table/hand.tsx:handStyles.emptyHandText": { plate: SELF },
  "table/pile.tsx:pileStyles.winnerText": { plate: "pileStyles.winnerTag" },
  "table/pile.tsx:pileStyles.comboChipText": { plate: "pileStyles.comboChip" },
  "table/pile.tsx:pileStyles.comboChipTextPower": { plate: "pileStyles.comboChip" },
  "table/rematchPrompt.tsx:styles.rematchTally": REMATCH,
  "table/rematchPrompt.tsx:styles.rematchTitle": REMATCH,
  "table/rematchPrompt.tsx:styles.rematchSubtitle": REMATCH,
  "table/rematchPrompt.tsx:styles.rematchChoiceLabel": { plate: ["styles.rematchPanel", "styles.rematchChoice"] },
  "table/rematchPrompt.tsx:styles.rematchChoiceYesLabel": { plate: ["styles.rematchPanel", "styles.rematchChoiceYes"] },
  "table/rotateOverlay.tsx:portraitOverlayStyles.title": { plate: "portraitOverlayStyles.overlay" },
  "table/rotateOverlay.tsx:portraitOverlayStyles.sub": { plate: "portraitOverlayStyles.overlay" },
  // The disc's own gradient is darker than both stand-in stops.
  "table/seats.tsx:seatStyles.discInitials": { stops: [3, 4] },
  "table/seats.tsx:seatStyles.countBubbleText": { plate: "seatStyles.countBubble" },
  "table/seats.tsx:seatStyles.countBubbleTextLast": { plate: "seatStyles.countBubble" },
  "table/seats.tsx:seatStyles.oppName": { plate: SELF },
  "table/seats.tsx:seatStyles.oppNameActive": { plate: "seatStyles.oppName" },
  "table/settingsSheet.tsx:sheetStyles.rowLabel": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.rowHint": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.header": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.foot": { gradient: SHEET },
  "table/settingsSheet.tsx:sheetStyles.exitLabel": { gradient: Gradient.garnet },
};

/** A disabled control's label is held to the large-text bar, WCAG's floor for inactive UI. */
const DISABLED = new Set(["table/actions.tsx:styles.btnDimLabel"]);

const TABLE_TEXT = tableTextStyles();

test("every inked <TableText> style says what it is painted over", () => {
  assert.ok(TABLE_TEXT.length > 30, `found only ${TABLE_TEXT.length} <TableText> styles`);
  const unclassified = TABLE_TEXT.filter(([file, ref]) => styleInk(file, ref) !== null && !(`${file}:${ref}` in ON_TABLE));
  assert.deepEqual(unclassified, [], "add these to ON_TABLE");
  const stale = Object.keys(ON_TABLE).filter((id) => !TABLE_TEXT.some(([file, ref]) => `${file}:${ref}` === id));
  assert.deepEqual(stale, [], "no <TableText> names these any more");
});

for (const [file, ref] of TABLE_TEXT) {
  const id = `${file}:${ref}`;
  const backdrop = ON_TABLE[id];
  if (!backdrop) continue;
  const min = DISABLED.has(id) ? LARGE_MIN : BODY_MIN;
  test(`the table's ${ref} clears ${min}:1 on every felt stop`, () => {
    const ink = styleInk(file, ref);
    assert.ok(ink, `${id} has no color`);
    const fills = [backdrop.plate ?? []].flat().map((plate) => {
      const fill = styleFill(file, plate === SELF ? ref : plate);
      assert.ok(fill, `${plate} no longer paints a background`);
      return fill;
    });

    for (const [felt, gradient] of Object.entries(FeltGradients)) {
      for (const stop of backdrop.stops ?? ANY_STOP) {
        for (const over of backdrop.gradient ?? [gradient[stop]]) {
          const surface = fills.reduce((under, fill) => resolve(fill, under), resolve(over, gradient[stop]));
          const ratio = contrastRatio(resolve(ink, surface), surface);
          assert.ok(ratio >= min, `${id} over ${felt} stop ${stop} (${over}) is only ${ratio.toFixed(2)}:1, needs >=${min}:1`);
        }
      }
    }
  });
}

function ratioAgainstAllSurfaces(color: string): Record<keyof typeof SURFACES, number> {
  const out = {} as Record<keyof typeof SURFACES, number>;
  for (const [name, bgHex] of Object.entries(SURFACES)) {
    out[name as keyof typeof SURFACES] = contrastRatio(resolve(color, bgHex), bgHex);
  }
  return out;
}

// --- Body text: must hit 4.5:1 on every surface it appears on --------------
// These colors are used for ordinary paragraph/label text throughout the app
// (menus, banners, in-game HUD over the felt), so they must clear the body
// threshold on bg, bgCard, AND felt.

const BODY_TEXT_COLORS: Record<string, string> = {
  white: Colors.white,
  text: Colors.text,
  textSecondary: Colors.textSecondary,
  textMuted: Colors.textMuted,
  gold: Colors.gold,
  goldLight: Colors.goldLight,
  goldLit: Colors.goldLit,
  accent: Colors.accent,
};

for (const [name, color] of Object.entries(BODY_TEXT_COLORS)) {
  test(`Colors.${name} passes body text contrast (>=${BODY_MIN}:1) on bg, bgCard, and felt`, () => {
    const ratios = ratioAgainstAllSurfaces(color);
    for (const [surface, ratio] of Object.entries(ratios)) {
      assert.ok(
        ratio >= BODY_MIN,
        `Colors.${name} vs ${surface} is only ${ratio.toFixed(2)}:1, needs >=${BODY_MIN}:1 for body text`
      );
    }
  });
}

// --- Large-only text: colors known to only clear the large-text bar --------
// These are documented as large-text-safe, not body-text-safe. If one of
// these ever creeps up to BODY_MIN it's a welcome improvement (test still
// passes); if it drops below LARGE_MIN, that's a real regression.

const LARGE_ONLY_TEXT_COLORS: Record<string, string> = {
  goldDark: Colors.goldDark,
  info: Colors.info,
  // A fill: MenuButton's danger variant, the offline banner, the reconnect
  // border. It clears 4.5:1 on no surface the app has, so text may only reach
  // for it at >=18pt, or >=14pt bold — which in these units is 19px.
  danger: Colors.danger,
};

/** Tokens never drawn as text on the felt, so that surface does not apply. */
const NOT_ON_FELT = new Set(["danger"]);

for (const [name, color] of Object.entries(LARGE_ONLY_TEXT_COLORS)) {
  test(`Colors.${name} clears large-text contrast (>=${LARGE_MIN}:1) on bg, bgCard, and felt`, () => {
    const ratios = ratioAgainstAllSurfaces(color);
    for (const [surface, ratio] of Object.entries(ratios)) {
      if (surface === "felt" && NOT_ON_FELT.has(name)) continue;
      assert.ok(
        ratio >= LARGE_MIN,
        `Colors.${name} vs ${surface} is only ${ratio.toFixed(2)}:1, needs >=${LARGE_MIN}:1 even for large text`
      );
    }
  });
}

// --- The specific regression this test file exists to catch ----------------

test("Colors.dangerDim (move-rejection text) no longer fails contrast", () => {
  const ratios = ratioAgainstAllSurfaces(Colors.dangerDim);
  assert.ok(ratios.bg >= BODY_MIN, `dangerDim vs bg: ${ratios.bg.toFixed(2)}:1`);
  assert.ok(ratios.bgCard >= BODY_MIN, `dangerDim vs bgCard: ${ratios.bgCard.toFixed(2)}:1`);
  assert.ok(ratios.felt >= LARGE_MIN, `dangerDim vs felt: ${ratios.felt.toFixed(2)}:1`);
});

test("Colors.textMuted clears body text contrast on felt (the previously-failing surface)", () => {
  const ratio = contrastRatio(resolve(Colors.textMuted, Colors.felt), Colors.felt);
  assert.ok(ratio >= BODY_MIN, `textMuted vs felt: ${ratio.toFixed(2)}:1`);
});

// --- white-on-danger button label (large text: Rajdhani_700Bold @ 18) ------

test("Colors.white on Colors.danger background clears large-text contrast (button labels)", () => {
  // components/MenuButton.tsx renders white Rajdhani_700Bold @ FontSize.lg (18)
  // on a Colors.danger background — large/bold text, so LARGE_MIN applies.
  const ratio = contrastRatio(Colors.white, Colors.danger);
  assert.ok(ratio >= LARGE_MIN, `white vs danger: ${ratio.toFixed(2)}:1`);
});

// --- The table's two keys: GIOCA and PASSA (components/table/actions.tsx) --
// Both labels sit on a raked gradient rather than a flat fill, so the pair to
// check is the label against each stop the gradient actually visits —
// including the pressed variant, which is on screen for exactly as long as
// the finger reading the label is still down. FontSize.lg (18) Rajdhani Bold
// falls short of the 18.66px bold floor, so BODY_MIN applies, same as
// components/MenuButton.tsx's own primary label a few lines below.

// Both the resting gradient (Gradient.playButton, a real token — not a copy)
// and the pressed one (GIOCA_GRADIENT_PRESSED, a component-local array) are
// read rather than retyped, so a stop either one adds is caught without
// anyone remembering to mirror it here.
const GIOCA_GRADIENT_STOPS = [...new Set([...Gradient.playButton, ...sourceArray("GIOCA_GRADIENT_PRESSED")])];

for (const stop of GIOCA_GRADIENT_STOPS) {
  test(`GIOCA's label (Colors.bg) clears body text contrast on gradient stop ${stop}`, () => {
    const ratio = contrastRatio(Colors.bg, stop);
    assert.ok(ratio >= BODY_MIN, `bg vs ${stop}: ${ratio.toFixed(2)}:1`);
  });
}

const PASSA_GRADIENT_STOPS = [...new Set([...Gradient.garnet, ...sourceArray("PASS_GRADIENT_PRESSED")])];

for (const stop of PASSA_GRADIENT_STOPS) {
  test(`PASSA's label (Garnet.label) clears body text contrast on gradient stop ${stop}`, () => {
    const ratio = contrastRatio(Garnet.label, stop);
    assert.ok(ratio >= BODY_MIN, `Garnet.label vs ${stop}: ${ratio.toFixed(2)}:1`);
  });
}

// components/MenuButton.tsx's own primary label — the reference the two above
// are held to. Confirms the home screen's gold buttons are not the same
// regression in disguise.
const MENU_BUTTON_GRADIENT_STOPS = [
  ...new Set([...Gradient.menuButton, ...sourceArray("PRIMARY_GRADIENT_PRESSED")]),
];

for (const stop of MENU_BUTTON_GRADIENT_STOPS) {
  test(`MenuButton's primary label (Colors.bg) clears body text contrast on gradient stop ${stop}`, () => {
    const ratio = contrastRatio(Colors.bg, stop);
    assert.ok(ratio >= BODY_MIN, `bg vs ${stop}: ${ratio.toFixed(2)}:1`);
  });
}
