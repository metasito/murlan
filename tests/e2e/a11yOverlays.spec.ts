// tests/e2e/a11yOverlays.spec.ts — the accessibility properties of the game's
// blocking overlays, which only a real browser can settle.
//
// A blocking overlay covers pixels and nothing else — what keeps the table
// behind it out of reach is the focus trap React Native's Modal brings, and a
// trap is only observable in a document that has focus in it.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openApp } from "./helpers/navigation";

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
