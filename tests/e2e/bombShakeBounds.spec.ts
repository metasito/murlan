// tests/e2e/bombShakeBounds.spec.ts — the felt has to still be under the table
// when the bomb's landing throws it about (#101).
//
// The owner landed a bomb on a physical iPhone and reported the shake itself as
// right, and the *bounds* as wrong: "it moves the screen too much, enough to
// show the 'white part' outside of the colored felt, like it moves a page out
// of its boundary". That is not an amplitude to turn down. It is a claim about
// which layer moves, and it can only be true or false in a browser —
// `react-test-renderer` computes no layout at all, so no native test can say
// where the felt's edge is on screen (CLAUDE.md).
//
// The measurement is the felt's own `getBoundingClientRect`, sampled every
// animation frame across the whole landing: that is the box the compositor
// paints into, transforms and all, not a style anyone wrote down. A transform
// that reads correctly in the style and wrong on screen is exactly this
// defect, so the frame with the worst coverage is also photographed and its
// four corners sampled for the page's own background.
//
// The mechanism is asserted alongside the outcome: a run where the bomb never
// landed would leave the table exactly where it started and satisfy every
// coverage assertion below while proving nothing.
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { resumeSaved } from "./helpers/offlineSeed";
import { E2E_SUSPEND_AI_KEY } from "../../lib/e2eAiSuspend";
import { buildCombination, type Card, type Rank, type Suit } from "../../lib/gameEngine";
import { GIOCA_VALID_LABEL } from "./helpers/labels.ts";
import { HAND_ZONE, TABLE } from "./helpers/selectors.ts";
import { tap } from "./helpers/press";

/** The reference handset, and the viewport every other table spec measures at. */
const VIEWPORT = { width: 844, height: 390 };

/**
 * How long the landing is watched for.
 *
 * The throw is ~380ms, the impact fires ~312ms into it, and the kick it starts
 * runs 1600ms from there (`KICK_MS`, components/useTableFeedback.ts) against a
 * 360ms shake. Comfortably past the last of them, because the assertion is
 * that *no* frame in the whole excursion uncovers the felt.
 */
const LANDING_WINDOW_MS = 2_600;

/** How many frames are photographed while the table is moving. */
const SHOTS = 14;

/**
 * The corner patch sampled out of each screenshot, in CSS pixels.
 *
 * The corners rather than the whole border: the chips, the rail and the hand
 * all reach an edge and are bright, and all three move with the kick, so a
 * border-wide sample would report a card face sliding into the strip as an
 * uncovered one. Nothing is drawn into the last three pixels of a corner —
 * `hudLeft` is inset by `frame.pad` — so the only thing that can turn one
 * bright is the window showing through.
 */
const CORNER_PX = 3;

/**
 * How much brighter than the resting corner a sampled one may be.
 *
 * Generous on purpose. The felt's rim is `Colors.bg` under the vignette, so
 * every corner rests in the low tens; react-navigation's own card background —
 * what a moved page uncovers — is rgb(242,242,242). A drift of 40 cannot be
 * that and a step to that cannot hide under 40.
 */
const BACKGROUND_DELTA = 40;

/** The smallest displacement that counts as the kick having actually run. */
const KICK_FLOOR_PX = 5;

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const SPOKEN_SUIT: Record<NonNullable<Suit>, string> = {
  hearts: "Cuori",
  diamonds: "Quadri",
  clubs: "Fiori",
  spades: "Picche",
};
const spoken = (c: Card) => `${c.rank} di ${SPOKEN_SUIT[c.suit!]}`;

/**
 * Four of a rank, which `isBomb` (lib/gameEngine.ts) is exactly four of, and
 * three spare cards so the play cannot empty the hand — an emptied one closes
 * the manche, and `landingTier` would then rank the landing `mancheWon`, whose
 * trauma is lower than the bomb's and whose kick does not fire at all.
 */
const BOMB = (["hearts", "diamonds", "clubs", "spades"] as const).map((s) => card("7", s));
const VIEWER_HAND = [...BOMB, card("4", "hearts"), card("5", "diamonds"), card("6", "clubs")];
/** Nothing here can beat a bomb, and with the AI held it never gets to try. */
const BOT_HAND = (["4", "6", "8", "10", "Q"] as const).map((r) => card(r, "spades"));
/** A single the bomb beats — a bomb beats anything but a higher bomb (`canBeat`). */
const PILE_CARD = card("3", "clubs");

function bombSave() {
  return {
    version: 2,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: VIEWER_HAND, type: "human" },
        { id: "player_1", name: "Bea", hand: BOT_HAND, type: "ai" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: buildCombination([PILE_CARD]),
      lastPlayedBy: 1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
    },
    match: {
      length: "single",
      target: 21,
      scores: {},
      hands: [],
      over: false,
      winners: [],
      isDraw: false,
    },
    rematchAnswers: {},
    players: [
      { name: "Ana", type: "human" },
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

interface Landing {
  frames: number;
  /** The least the felt overhung each edge of the window, across every frame. */
  cover: { left: number; top: number; right: number; bottom: number };
  /** How far the table itself was thrown from where it started. */
  peakDx: number;
  peakDy: number;
  /** The brightest the flare ever reached, and whether it was on screen at all. */
  flareOpacity: number;
  flareSeen: boolean;
}

/**
 * Starts an every-frame record of where the felt is and how far the table has
 * moved, and leaves it on `window` to be read once the landing is over.
 *
 * Every frame rather than a few samples: the kick is a decaying series of
 * jolts, so a poll can land between two of them and read the table at rest in
 * the middle of the excursion.
 */
async function watchLanding(page: Page): Promise<void> {
  await page.evaluate((windowMs) => {
    const felt = document.querySelector('[data-testid="table-felt"]');
    const table = document.querySelector('[data-testid="game-table"]');
    if (!felt || !table) throw new Error("the felt or the table never rendered");
    const rest = table.getBoundingClientRect();
    const state = {
      frames: 0,
      cover: { left: Infinity, top: Infinity, right: Infinity, bottom: Infinity },
      peakDx: 0,
      peakDy: 0,
      flareOpacity: 0,
      flareSeen: false,
      done: false,
    };
    (window as unknown as { __landing: typeof state }).__landing = state;
    const started = performance.now();
    const step = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const r = felt.getBoundingClientRect();
      // Positive is overhang past the window's own edge; negative is a strip
      // of window the felt has stopped covering.
      state.cover.left = Math.min(state.cover.left, 0 - r.left);
      state.cover.top = Math.min(state.cover.top, 0 - r.top);
      state.cover.right = Math.min(state.cover.right, r.right - w);
      state.cover.bottom = Math.min(state.cover.bottom, r.bottom - h);
      const t = table.getBoundingClientRect();
      state.peakDx = Math.max(state.peakDx, Math.abs(t.left - rest.left));
      state.peakDy = Math.max(state.peakDy, Math.abs(t.top - rest.top));
      const flare = document.querySelector('[data-testid="bomb-flare"]');
      if (flare) {
        state.flareSeen = true;
        const o = Number(getComputedStyle(flare).opacity);
        if (Number.isFinite(o)) state.flareOpacity = Math.max(state.flareOpacity, o);
      }
      state.frames += 1;
      if (performance.now() - started < windowMs) requestAnimationFrame(step);
      else state.done = true;
    };
    requestAnimationFrame(step);
  }, LANDING_WINDOW_MS);
}

async function readLanding(page: Page): Promise<Landing> {
  await page.waitForFunction(
    () => (window as unknown as { __landing?: { done: boolean } }).__landing?.done === true,
    undefined,
    { timeout: LANDING_WINDOW_MS * 2 }
  );
  return page.evaluate(
    () => (window as unknown as { __landing: Landing }).__landing
  );
}

/** The brightest pixel in any of the window's four corners, as the compositor drew it. */
async function cornerLuminance(page: Page): Promise<number> {
  const shot = (await page.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(
    async ({ png, patch, viewport }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      // The screenshot is in device pixels and the patch in CSS ones.
      const scale = img.width / viewport.width;
      const side = Math.max(1, Math.round(patch * scale));
      const corners = [
        [0, 0],
        [img.width - side, 0],
        [0, img.height - side],
        [img.width - side, img.height - side],
      ] as const;
      let hi = 0;
      for (const [x, y] of corners) {
        const { data } = ctx.getImageData(x, y, side, side);
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (lum > hi) hi = lum;
        }
      }
      return hi;
    },
    { png: shot, patch: CORNER_PX, viewport: VIEWPORT }
  );
}

const named = (page: Page, name: string) =>
  page.locator(HAND_ZONE).getByRole("button", { name, exact: true });

/**
 * A table with the bomb selected and GIOCA armed, one tap from the landing.
 *
 * The AI is held for the life of the page (`lib/e2eAiSuspend.ts`). It is not a
 * convenience: `EXPO_PUBLIC_E2E_FAST` answers for the seat in ~0ms, and a pass
 * closes the round heads-up, which takes `GameTable`'s own pile effect down the
 * `combo === null` branch and **clears the pending impact timer** — so the
 * bomb's whole landing, kick and flare included, is cancelled ~300ms before it
 * was due to fire and every measurement below reads a table at rest.
 */
async function armedBomb(page: Page, baseURL: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  // The tier lands at zero under reduced motion — no kick, no flare — so a run
  // that inherited it would assert nothing at all.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(key, "1");
  }, E2E_SUSPEND_AI_KEY);

  await resumeSaved(page, baseURL, bombSave());
  await page.locator(TABLE).waitFor({ timeout: 30_000 });

  expect(
    await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    "this browser is asking for reduced motion, which zeroes every tier this spec measures"
  ).toBe(false);

  for (const c of BOMB) await tap(page, named(page, spoken(c)));
  await expect(
    page.getByTestId("btn-gioca"),
    "four of a rank over a single is a bomb, so GIOCA has to offer the play"
  ).toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout: 10_000 });
}

test.describe("a bomb's landing never moves the felt off the window (#101)", () => {
  test("the felt covers every edge through the whole excursion", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await armedBomb(page, baseURL!);

    const atRest = await cornerLuminance(page);

    await watchLanding(page);
    await tap(page, page.getByTestId("btn-gioca"));

    let brightest = 0;
    for (let i = 0; i < SHOTS; i++) brightest = Math.max(brightest, await cornerLuminance(page));

    const landing = await readLanding(page);

    // The mechanism, before the outcome: a landing that never displaced the
    // table would leave the felt exactly where it started and pass everything
    // below without the defect ever having had a chance to appear.
    expect(landing.frames, "the frame sampler never ran").toBeGreaterThan(30);
    expect(
      Math.max(landing.peakDx, landing.peakDy),
      `the bomb never threw the table — peak displacement ${landing.peakDx.toFixed(2)} x ${landing.peakDy.toFixed(2)}px, so nothing below was tested`
    ).toBeGreaterThan(KICK_FLOOR_PX);

    const worst = landing.cover;
    const report =
      `felt overhang at its worst, per edge: left ${worst.left.toFixed(2)}, top ${worst.top.toFixed(2)}, ` +
      `right ${worst.right.toFixed(2)}, bottom ${worst.bottom.toFixed(2)}px ` +
      `(negative is window the felt stopped covering), across ${landing.frames} frames, ` +
      `with the table thrown ${landing.peakDx.toFixed(2)} x ${landing.peakDy.toFixed(2)}px`;
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      expect(worst[edge], `the felt left the window's ${edge} edge. ${report}`).toBeGreaterThanOrEqual(
        -0.5
      );
    }

    expect(
      brightest,
      `a corner of the window brightened to ${brightest.toFixed(1)} during the landing, from ${atRest.toFixed(1)} at rest — the page behind the table showing through. ${report}`
    ).toBeLessThan(atRest + BACKGROUND_DELTA);
  });

  /**
   * #101's second, unsettled half, recorded rather than argued: the owner's
   * prose said the flare was never seen and the same pass's radio button said
   * its edge was stepped. This says only what a browser does — the flare is on
   * screen and reaches full opacity at a real bomb's landing. It cannot speak
   * for iOS, which is where the report came from and where a capture is still
   * the only instrument (RULES.md 36).
   */
  test("the flare reaches the paint at that same landing, in Chromium", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await armedBomb(page, baseURL!);

    await watchLanding(page);
    await tap(page, page.getByTestId("btn-gioca"));
    const landing = await readLanding(page);

    expect(landing.flareSeen, "the flare node is never rendered at all").toBe(true);
    expect(
      landing.flareOpacity,
      `the flare stayed at ${landing.flareOpacity.toFixed(3)} opacity across ${landing.frames} frames of a bomb's landing`
    ).toBeGreaterThan(0.8);
  });
});
