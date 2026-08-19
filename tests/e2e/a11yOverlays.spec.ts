// tests/e2e/a11yOverlays.spec.ts — the accessibility properties of the game
// table that only a real browser can settle.
//
// A blocking overlay covers pixels and nothing else — what keeps the table
// behind it out of reach is the focus trap React Native's Modal brings, and a
// trap is only observable in a document that has focus in it. What a large
// text setting does to the table's fixed card geometry is the other question
// no renderer can answer: it needs real font metrics.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp, startOfflineGame } from "./helpers/navigation";

const TABLE = '[data-testid="game-table"]';

// ── A11Y-02 ──────────────────────────────────────────────────────────────────

/**
 * A hand mid-exchange, with the viewer as the winner who owes a card back.
 *
 * Seeded rather than played: driving an offline hand to its end takes minutes
 * and repeatedly did not finish at all, and none of that is what this test is
 * about. `lib/offlineSave.ts` is the app's own restore path — AsyncStorage is
 * plain localStorage on web — so this arrives at the overlay through the same
 * code a player's interrupted match does.
 */
function midExchangeSave() {
  const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });
  const winnerHand = [
    card("4_hearts", "4", "hearts"),
    card("9_clubs", "9", "clubs"),
    card("K_spades", "K", "spades"),
  ];
  const loserHand = [card("5_diamonds", "5", "diamonds"), card("J_hearts", "J", "hearts")];
  return {
    version: 2,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: winnerHand, type: "human" },
        { id: "player_1", name: "Luan", hand: loserHand, type: "ai" },
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      exchangePhase: {
        active: true,
        winnerIdx: 0,
        loserIdx: 1,
        cardFromLoser: card("2_spades", "2", "spades"),
        bothJokersException: false,
      },
    },
    match: {
      length: "match",
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
      { name: "Luan", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

/** Where focus lands after `presses` tabs, as `<dialog-descendant>|<label>`. */
async function tabTour(page: Page, presses: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "body";
        const inDialog = el.closest('[aria-modal="true"]') !== null;
        const name =
          el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? el.tagName;
        return `${inDialog ? "in" : "OUT"}|${name}`;
      })
    );
  }
  return seen;
}

test("the exchange overlay keeps the tab order inside itself", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openApp(page, baseURL!);
  await page.evaluate(
    (save) => window.localStorage.setItem("@murlan_offline_game", JSON.stringify(save)),
    midExchangeSave()
  );
  await page.reload();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Riprendi partita" }).click();
  await page.locator(TABLE).waitFor({ timeout: 30_000 });

  const dialog = page.locator('[aria-modal="true"]');
  await expect(dialog, "the exchange overlay has to be a real modal").toBeVisible({
    timeout: 15_000,
  });

  // The hand behind it is still in the document — an overlay covers pixels and
  // nothing else — so the trap is the only thing keeping it out of reach.
  const handBehind = page.locator(`${TABLE} [aria-label^="La tua mano"] [role="button"]`);
  expect(await handBehind.count(), "the table underneath is still rendered").toBeGreaterThan(0);

  // More presses than the overlay has controls, so the tour wraps: an untrapped
  // order would have escaped into the table well before the last one.
  const tour = await tabTour(page, 24);
  expect(tour.filter((stop) => stop.startsWith("OUT"))).toEqual([]);
});

// ── A11Y-13 ──────────────────────────────────────────────────────────────────

// The table is built from fixed boxes (components/cardFaceModel.ts CARD_W /
// CARD_H) while a text setting scales `fontSize` and leaves `lineHeight`,
// `width` and `height` alone, so every Text inside it declares
// maxFontSizeMultiplier={TABLE_FONT_SCALE_MAX}. tests/fontScaling.test.ts pins
// that the cap is declared; whether the cap is *enough* is a question about
// glyph metrics inside a card that clips (CardView styles.card is
// `overflow: hidden`), which only a real text engine can answer.
const TABLE_FONT_SCALE_MAX = 1.2;
// What iOS goes up to with no cap at all — the state the prop exists to refuse.
const IOS_MAX_TEXT_SCALE = 3.1;

interface Clipped {
  label: string;
  text: string;
  outsideBy: string;
}

/**
 * Every text in the table whose glyphs would be cut off by a clipping ancestor
 * once `fontSize` is multiplied by `scale`.
 *
 * Ink, not line box: a Text taller than its own `lineHeight` still draws in
 * full — what removes a glyph is an ancestor with `overflow: hidden`, which is
 * what a card is.
 */
async function clippedGlyphs(page: Page, scale: number): Promise<Clipped[]> {
  return page.evaluate((factor) => {
    const table = document.querySelector('[data-testid="game-table"]');
    if (!table) return [];
    // A screen-reader-only node (lib/a11y.tsx `srOnly`) is a 1px box that
    // clips its own sentence on purpose, so size is what tells the two apart.
    const SR_ONLY_MAX = 2;
    const leaves = Array.from(table.querySelectorAll<HTMLElement>("*")).filter(
      (el) =>
        el.children.length === 0 &&
        (el.textContent ?? "").trim().length > 0 &&
        el.clientWidth > SR_ONLY_MAX &&
        el.clientHeight > SR_ONLY_MAX
    );
    for (const el of leaves) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(size)) el.style.fontSize = `${size * factor}px`;
    }

    const clipperOf = (el: HTMLElement): HTMLElement | null => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") {
          return p;
        }
      }
      return null;
    };

    const out: { label: string; text: string; outsideBy: string }[] = [];
    for (const el of leaves) {
      const clipper = clipperOf(el);
      if (!clipper) continue;
      const box = el.getBoundingClientRect();
      // The glyphs can draw outside the line box in either direction, so the
      // ink extent is the box grown by the overflow on every side.
      const padX = Math.max(0, el.scrollWidth - el.clientWidth);
      const padY = Math.max(0, el.scrollHeight - el.clientHeight);
      const limit = clipper.getBoundingClientRect();
      const outside = Math.max(
        limit.top - (box.top - padY),
        limit.left - (box.left - padX),
        box.bottom + padY - limit.bottom,
        box.right + padX - limit.right
      );
      // Sub-pixel differences are rounding, not a lost glyph.
      if (outside > 1) {
        out.push({
          label: el.closest("[aria-label]")?.getAttribute("aria-label") ?? "",
          text: (el.textContent ?? "").trim().slice(0, 24),
          outsideBy: outside.toFixed(1),
        });
      }
    }
    return out;
  }, scale);
}

test("no rank glyph clips at the table's font-scale cap", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await openApp(page, baseURL!);
  await startOfflineGame(page, { playerCount: 4, gameMode: "free_for_all" });
  await page.locator(TABLE).waitFor({ timeout: 60_000 });

  const atCap = await clippedGlyphs(page, TABLE_FONT_SCALE_MAX);
  expect(
    atCap,
    `clipped at the declared cap of ${TABLE_FONT_SCALE_MAX}x:
${JSON.stringify(atCap, null, 2)}`
  ).toEqual([]);

  // The other half, and the reason the cap is not a no-op: uncapped, the same
  // measurement finds glyphs the card cuts off. Without this the check above
  // would pass just as happily against a table that never clips anything.
  const uncapped = await clippedGlyphs(page, IOS_MAX_TEXT_SCALE / TABLE_FONT_SCALE_MAX);
  expect(
    uncapped.length,
    `at ${IOS_MAX_TEXT_SCALE}x the cap has to be what saves the glyphs`
  ).toBeGreaterThan(0);
});
