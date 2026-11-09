// WCAG 2.x contrast audit for lib/theme.ts text colors. Palette-wide tokens
// are measured against bg, bgCard and the felt's middle stop. The styles that draw inside the
// table are measured against every stop of every felt by tests/native/tableTextContrast.test.tsx,
// which reads them from the modules' own StyleSheets.
//
// This exists so a future palette edit can't silently regress accessibility —
// see lib/theme.ts "Text colors" section.
//
// Imports lib/tokens — the same palette — not lib/theme, whose Shadow helper pulls
// react-native in; that and the extension — docs/agents/checks.md, "Node's TypeScript loader".
import { Colors, Garnet, Gradient, FeltGradients, NoticePalette } from "../../lib/tokens.ts";
import { contrastRatio, relativeLuminance } from "../../lib/contrast.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BODY_MIN, LARGE_MIN, readsOf, resolve, sourceArrays } from "../helpers/contrastColours.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceArray = sourceArrays(root, readsOf(root, "tests/native/tableTextContrast.test.tsx"));

test("lib/contrast reads hex pairs either way round, from 1:1 to 21:1", () => {
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#FFFFFF", "#000000"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  for (const bad of ["#fff", "#ffffff80", "ffffff", "#gggggg", "rgba(0,0,0,1)"]) {
    assert.throws(() => contrastRatio(bad, "#000000"), new RegExp(bad.replace(/[()]/g, "\\$&")));
  }
});

const SURFACES = {
  bg: Colors.bg,
  bgCard: Colors.bgCard,
  felt: Colors.felt,
} as const;

test("the notice palette holds every shape, each with a tone", () => {
  assert.deepEqual(Object.keys(NoticePalette).sort(), ["chip", "float", "panel", "pill"]);
  for (const tones of Object.values(NoticePalette)) assert.ok(Object.keys(tones).length > 0);
});

for (const [shape, tones] of Object.entries(NoticePalette)) {
  for (const [tone, paint] of Object.entries(
    tones as Record<string, { fill: string; ink: string; strong: string; warn?: string; top?: string; quiet?: string }>
  )) {
    test(`a ${tone} notice ${shape}'s every ink clears body contrast on every felt stop`, () => {
      const inks = Object.entries({ ink: paint.ink, strong: paint.strong, warn: paint.warn, quiet: paint.quiet }).filter(([, ink]) => ink !== undefined);
      for (const [felt, gradient] of Object.entries(FeltGradients)) {
        for (const stop of gradient) {
          for (const surface of [paint.fill, paint.top ?? paint.fill].map((fill) => resolve(fill, stop))) {
            for (const [which, ink] of inks as [string, string][]) {
              const ratio = contrastRatio(resolve(ink, surface), surface);
              assert.ok(ratio >= BODY_MIN, `${shape}.${tone}.${which} over ${felt} ${stop} is only ${ratio.toFixed(2)}:1`);
            }
          }
        }
      }
    });
  }
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
  copper: Colors.copper,
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
  // A fill: MenuButton's danger variant. It clears 4.5:1 on no surface the app has, so text may only reach
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
