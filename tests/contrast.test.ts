// WCAG 2.x contrast audit for lib/theme.ts text colors. Palette-wide tokens
// are measured against bg, bgCard and the felt's middle stop; every style that
// draws inside the table is measured against every stop of every felt, which
// is the only place the gradient's 2x luminance range can be seen.
//
// This exists so a future palette edit can't silently regress accessibility —
// see lib/theme.ts "Text colors" section.
//
// The .ts extension on the import is required by Node's ESM loader when it
// type-strips these files (`node --test tests/**/*.test.ts`).
// Imports lib/tokens (pure values) rather than lib/theme, because theme pulls in
// react-native for its platform-aware Shadow helper and Node cannot parse RN's
// Flow-typed entry point. tokens.ts is the same palette, no runtime RN dependency.
// @ts-ignore
import { Colors, Scrim, FeltGradients } from "../lib/tokens.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
// components/GameTable.tsx paints a five-stop LinearGradient. The top of the
// table is 1.9x the relative luminance of the stop this file used to measure,
// so a token could pass here at 4.60 and render at 3.43 where it is actually
// drawn.
//
// Both colours are read out of components/GameShared.tsx rather than repeated
// here, so a plate that is removed from a style is a failure rather than a
// silent pass against a fill nothing paints.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = readFileSync(path.join(repoRoot, "components", "GameShared.tsx"), "utf8");
const PALETTES: Record<string, Record<string, string>> = { Colors, Scrim };

/** The body of a `name: { … }` entry in one of GameShared's StyleSheets. */
function styleBlock(style: string): string {
  const open = `\n  ${style}: {\n`;
  const at = SHARED.indexOf(open);
  assert.notEqual(at, -1, `components/GameShared.tsx has no style named ${style}`);
  assert.equal(SHARED.indexOf(open, at + 1), -1, `${style} is defined more than once`);
  const close = SHARED.indexOf("\n  },", at + open.length);
  return SHARED.slice(at + open.length, close);
}

/** A style's `color` or `backgroundColor`, resolved to its token value. */
function styleColor(style: string, prop: "color" | "backgroundColor"): string | null {
  const m = new RegExp(String.raw`\b${prop}: ([A-Za-z]+)\.([A-Za-z]+)`).exec(styleBlock(style));
  return m ? PALETTES[m[1]]?.[m[2]] ?? null : null;
}

/** Which gradient stops an element can sit over. locations are [0,.25,.5,.75,1]. */
const ANY_STOP = [0, 1, 2, 3, 4];

/**
 * Every text style drawn inside the table, with the style whose fill it sits
 * on. `plate: null` means straight onto the felt.
 */
const ON_FELT_TEXT: { text: string; plate: string | null; stops: number[] }[] = [
  { text: "oppName", plate: "oppName", stops: ANY_STOP },
  { text: "comboChipText", plate: "comboChip", stops: ANY_STOP },
  { text: "comboChipTextPower", plate: "comboChip", stops: ANY_STOP },
  { text: "winnerText", plate: "winnerTag", stops: ANY_STOP },
  { text: "countBubbleText", plate: "countBubble", stops: ANY_STOP },
  { text: "passedChipText", plate: "passedChip", stops: ANY_STOP },
  { text: "botBadgeText", plate: "botBadge", stops: ANY_STOP },
  // The hand row is the bottom band of the table, the darkest end of every felt.
  { text: "emptyHandText", plate: null, stops: [3, 4] },
  // The avatar disc is an opaque gradient from the felt's own stops 1 and 3.
  { text: "avatarInitials", plate: null, stops: [1, 3] },
];

for (const { text, plate, stops } of ON_FELT_TEXT) {
  test(`GameShared ${text} clears body text contrast on every felt stop`, () => {
    const ink = styleColor(text, "color");
    assert.ok(ink, `GameShared ${text} has no color`);
    const fill = plate ? styleColor(plate, "backgroundColor") : null;
    assert.ok(!plate || fill, `GameShared ${plate} no longer paints a background`);

    for (const [felt, gradient] of Object.entries(FeltGradients)) {
      for (const stop of stops) {
        const backdrop = fill ? resolve(fill, gradient[stop]) : gradient[stop];
        const ratio = contrastRatio(resolve(ink, backdrop), backdrop);
        assert.ok(
          ratio >= BODY_MIN,
          `GameShared ${text} over ${felt} stop ${stop} is only ${ratio.toFixed(2)}:1, needs >=${BODY_MIN}:1`
        );
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
  red: Colors.red,
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
