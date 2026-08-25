// tests/e2e/exchangePickChange.spec.ts — changing the exchange pick before
// confirming.
//
// components/ExchangeModal.tsx holds the pick in one `useState`, so tapping a
// second giveback card has to replace the first rather than add to it. That
// needs two sequential state-changing presses on one mount, which
// react-test-renderer cannot see (tests/native/exchangeModalConfirm.test.tsx
// explains why); only a real re-render, in a real browser, catches it — #328.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";

/** Two cards in the 3–10 giveback range, so both are valid picks. */
const FIVE = { id: "5_hearts", rank: "5", suit: "hearts", isJoker: false };
const NINE = { id: "9_clubs", rank: "9", suit: "clubs", isJoker: false };
const FIVE_SPOKEN = "5 di Cuori";
const NINE_SPOKEN = "9 di Fiori";

/**
 * A hand mid-exchange, with the viewer as the winner choosing a giveback —
 * seeded rather than played, the same way tests/e2e/a11yOverlays.spec.ts
 * reaches this phase. `lib/offlineSave.ts` is the app's own restore path, so
 * this arrives at the modal through the same code an interrupted match does.
 */
function midExchangeSave() {
  const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });
  const winnerHand = [FIVE, NINE, card("K_spades", "K", "spades")];
  const loserHand = [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")];
  return {
    version: 2,
    gameState: {
      players: [
        { id: "player_0", name: "Ana", hand: winnerHand, type: "human" },
        { id: "player_1", name: "Bea", hand: loserHand, type: "ai" },
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
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

/**
 * The exchange modal, scoped apart from the page: the hand it sits over is
 * still in the document underneath it (a11yOverlays.spec.ts's own finding),
 * and the winner's hand holds the same cards the modal offers as picks — an
 * unscoped `getByRole` for a card name matches both.
 */
async function openExchangeModal(page: Page, baseURL: string) {
  await resumeSaved(page, baseURL, midExchangeSave());

  const dialog = page.getByRole("dialog", { name: "Scambio di carte" });
  await expect(dialog, "the exchange modal has to open").toBeVisible({ timeout: 15_000 });
  return dialog;
}

test("changing the exchange pick before confirming gives the last card chosen", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const dialog = await openExchangeModal(page, baseURL!);

  // Choose the five...
  await dialog.getByRole("button", { name: FIVE_SPOKEN, exact: true }).click();
  // ...then change to the nine before confirming.
  await dialog.getByRole("button", { name: NINE_SPOKEN, exact: true }).click();
  await dialog.getByTestId("exchange-confirm").click();

  // The confirm modal is gone and the announcement names exactly one card as
  // the winner's leg of the exchange — the last one picked, never the first
  // and never both.
  // A second `role="alert"` exists for the play-sound notification banner
  // this same confirm triggers, so the exchange announcement is picked out
  // by the leg it always states: "<winner> dà ... a <loser>".
  const alert = page.getByRole("alert", { name: /Ana dà .+ a Bea/ });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  const label = (await alert.getAttribute("aria-label")) ?? "";
  expect(label, "the second pick has to be the one announced as given").toContain(
    `Ana dà ${NINE_SPOKEN} a Bea`
  );
  expect(label, "the first pick must not be announced as given").not.toContain(
    `Ana dà ${FIVE_SPOKEN} a Bea`
  );

  // Ground truth in the actual hand, past the announcement: the nine left,
  // the five did not.
  await page.getByRole("button", { name: "Chiudi annuncio scambio" }).click();
  await expect(alert).toBeHidden({ timeout: 15_000 });

  const hand = page.locator('[aria-label^="La tua mano"]');
  await expect(
    hand.getByRole("button", { name: FIVE_SPOKEN, exact: true }),
    "the card not chosen last stays in the winner's hand"
  ).toBeVisible();
  await expect(
    hand.getByRole("button", { name: NINE_SPOKEN, exact: true }),
    "the card chosen last is the one actually given away"
  ).toHaveCount(0);
});
