// tests/e2e/exchangePickChange.spec.ts — changing the exchange pick before
// confirming.
//
// GameTable holds the pick in one `useState`, so tapping a second giveback
// card has to replace the first rather than add to it — and now that the fan
// itself is the picker (#533), the ordinary play selection is a multi-select
// living on those same cards. Getting the two confused gives away two cards, or
// the wrong one. Only a real re-render, in a real browser, catches it — #328.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";
import { HAND_ZONE, TABLE } from "./helpers/selectors.ts";
import { tap } from "./helpers/press";

/** Two cards in the 3–10 giveback range, so both are valid picks. */
const FIVE = { id: "5_hearts", rank: "5", suit: "hearts", isJoker: false };
const NINE = { id: "9_clubs", rank: "9", suit: "clubs", isJoker: false };
const FIVE_SPOKEN = "5 di Cuori";
const NINE_SPOKEN = "9 di Fiori";

/**
 * A hand mid-exchange, with the viewer as the winner choosing a giveback —
 * seeded rather than played, the same way tests/e2e/a11yOverlays.spec.ts
 * reaches this phase. `lib/offlineSave.ts` is the app's own restore path, so
 * this arrives at the exchange through the same code an interrupted match does.
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
 * The exchange, open on the felt. Scoped to the table because that is where the
 * cards are now — there is no second copy of them in a dialog any more.
 */
async function openExchange(page: Page, baseURL: string) {
  await resumeSaved(page, baseURL, midExchangeSave());

  await expect(
    page.getByTestId("exchange-prompt"),
    "the exchange has to ask on the felt"
  ).toBeVisible({ timeout: 15_000 });
  return page.locator(TABLE);
}

test("changing the exchange pick before confirming gives the last card chosen", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const table = await openExchange(page, baseURL!);

  // Choose the five...
  await tap(page, table.getByRole("button", { name: FIVE_SPOKEN, exact: true }));
  // ...then change to the nine before confirming.
  await tap(page, table.getByRole("button", { name: NINE_SPOKEN, exact: true }));
  await tap(page, page.getByTestId("btn-gioca"));

  // The prompt has left the felt and the announcement names exactly one card as
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

  // Ground truth in the actual hand, once the announcement has cleared itself:
  // the nine left, the five did not. Nothing dismisses it any more — it sits on
  // the felt for a reading beat and goes.
  await expect(alert).toBeHidden({ timeout: 20_000 });

  const hand = page.locator(HAND_ZONE);
  await expect(
    hand.getByRole("button", { name: FIVE_SPOKEN, exact: true }),
    "the card not chosen last stays in the winner's hand"
  ).toBeVisible();
  await expect(
    hand.getByRole("button", { name: NINE_SPOKEN, exact: true }),
    "the card chosen last is the one actually given away"
  ).toHaveCount(0);
});
