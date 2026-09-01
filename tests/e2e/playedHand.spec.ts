// tests/e2e/playedHand.spec.ts — one hand, played through every interaction the
// table gives the viewer.
//
// Reordering shipped with three specs proving reordering works, and none asked
// what it did to *selecting* a card — the interaction it shares a surface with.
// Selection broke and the suite stayed green (#675). A new interaction on a
// shared surface should have to pass the surface's existing job, so this spec is
// the surface's job: select, deselect, arrange, play, pass and exchange, in one
// hand, with real press durations.
//
// Every press here is a real one — down, a finger's worth of time, up — because
// `click()` puts down and up in the same frame and a card answers both, which is
// what decides select against drag (tests/e2e/helpers/press.ts).
//
// A card is pressed twice over, and the pair is the point. `tap` is delivered to
// the element, so it reports which card *owns a name*; a press at the middle of
// the art is delivered to a point, so it reports which card *owns the screen
// there*. Those are two different boxes on purpose — the pressable is the tap
// strip, and the card drawn inside it takes no hits of its own
// (components/CardView.tsx).
//
// It does not follow that this catches #683. Measured, it does not: one play
// leaves a stale strip about 3px narrower than its slot while the art's centre
// sits some 25px inside it, so the press lands on the right card anyway. What
// that defect needs is a guard on the strip's own geometry, which is #720.
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { resumeSaved } from "./helpers/offlineSeed";
import { buildCombination, type Card, type Rank, type Suit } from "../../lib/gameEngine";
import { GIOCA_VALID_LABEL, YOUR_TURN_PREFIX } from "./helpers/labels.ts";
import { HAND_CARDS, HAND_ZONE, TABLE, TABLE_STATE } from "./helpers/selectors.ts";
import { PHONES } from "./helpers/phones.ts";
import { PAST_HOLD_MS, tap, tapPoint } from "./helpers/press";
import { settled } from "./helpers/settle";
import { cardsInHands, driveGameToCompletion } from "./helpers/bot";

const RESULT_URL = /\/result/;
const SETTLE_MS = 1_500;

/** The reference handset, and the one every other table spec measures at. */
const PHONE = PHONES.find((p) => p.name === "iPhone 12")!;

const card = (id: string, rank: Rank, suit: Suit): Card => ({ id, rank, suit, isJoker: false });

// Numeric ranks throughout, because a card's accessible name is its rank as
// printed only below the court cards — J, Q, K and A speak through their own
// keys (`lib/cardNames.ts`), so naming one here would be restating a
// translation rather than reading it.
const PILE_CARD = card("3_clubs", "3", "clubs");

const SUITS = ["hearts", "diamonds", "clubs"] as const;
const SPOKEN_SUIT = { hearts: "Cuori", diamonds: "Quadri", clubs: "Fiori" } as const;

const spread = (ranks: readonly Rank[]) =>
  ranks.flatMap((rank) => SUITS.map((suit) => card(`${rank}_${suit}`, rank, suit)));

/**
 * A full fan, not a handful.
 *
 * Thirteen is what a seat is dealt, and it is also the only size at which this
 * spec can see the defect it exists for: a card's tap strip is one slot wide
 * (`hitW={step}`, components/table/hand.tsx), and at five cards the slots are
 * wider than the cards and never overlap — so a strip left at the previous
 * hand's width still covers its own card and a stale one is invisible. The
 * overlap is the mechanism.
 */
const VIEWER_HAND = [...spread(["4", "5", "6", "7"]), card("8_hearts", "8", "hearts")];
/**
 * Every viewer card loses to every bot card, and beats the seeded pile. That is
 * what makes both moves below legal by construction rather than by luck: the
 * play cannot be refused, and the pass cannot turn out to be a lead.
 */
const BOT_HAND = [...spread(["J", "Q", "K", "A"]), card("2_hearts", "2", "hearts")];

const spoken = (c: Card) => `${c.rank} di ${SPOKEN_SUIT[c.suit as keyof typeof SPOKEN_SUIT]}`;
/** The hand as the fan speaks it, ascending, which is the order it draws in. */
const VIEWER_SPOKEN = VIEWER_HAND.map(spoken);

const TO_PLAY = "8 di Cuori";
/**
 * Near the right of the fan, where a stale slot width has had the most cards to
 * accumulate over — the drift is cumulative from the left.
 */
const AFTER_PLAY = "7 di Fiori";
const TO_SELECT = "6 di Fiori";

/** A giveback the rules allow: 3–10, and not the card that arrived (§10). */
const GIVEBACK = "6 di Fiori";

function save(gameState: Record<string, unknown>) {
  return {
    version: 2,
    gameState: {
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      // Past the opening, so the table renders a hand in progress rather than a
      // first move waiting on the 3 of spades.
      firstPlayMade: true,
      ...gameState,
    },
    match: { length: "match", target: 21, scores: {}, hands: [], over: false, winners: [], isDraw: false },
    rematchAnswers: {},
    players: [
      { name: "Ana", type: "human" },
      { name: "Bea", type: "ai", personality: "luan" },
    ],
    gameMode: "free_for_all",
    dealFirstSeat: 0,
  };
}

const seats = (viewer: object[], bot: object[]) => [
  { id: "player_0", name: "Ana", hand: viewer, type: "human" },
  { id: "player_1", name: "Bea", hand: bot, type: "ai" },
];

/**
 * The viewer on move with a single on the felt that their whole hand beats.
 *
 * The pile is built by the engine rather than written out, because a
 * combination carries a strength the rules derive and a hand-written one is a
 * number this file would have to keep in step with `getCombinationStrength`.
 */
function midHandSave() {
  return save({
    players: seats(VIEWER_HAND, BOT_HAND),
    lastPlayedCombination: buildCombination([PILE_CARD]),
    lastPlayedBy: 1,
  });
}

/** The viewer as the manche's winner, choosing what to give back. */
function exchangeSave() {
  return save({
    players: seats(VIEWER_HAND, BOT_HAND.slice(0, 2)),
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: card("2_spades", "2", "spades"),
      bothJokersException: false,
    },
  });
}

/** Every hand card, left to right as drawn, by accessible name. */
async function handOrder(page: Page): Promise<string[]> {
  const boxes = await page.locator(HAND_CARDS).all();
  const placed = await Promise.all(
    boxes.map(async (b) => ({
      label: (await b.getAttribute("aria-label")) ?? "",
      x: (await b.boundingBox())?.x ?? 0,
    }))
  );
  return placed.sort((a, b) => a.x - b.x).map((p) => p.label);
}


const named = (page: Page, name: string) =>
  page.locator(TABLE).getByRole("button", { name, exact: true });

/**
 * The one card the table reports as selected.
 *
 * Read as a name rather than as a count, because "exactly one card is pressed"
 * is satisfied by the wrong card being the one — which is the whole failure
 * this spec exists to catch.
 */
async function selectedCard(page: Page): Promise<string[]> {
  const pressed = await page.locator(`${HAND_CARDS}[aria-pressed="true"]`).all();
  return Promise.all(pressed.map(async (p) => (await p.getAttribute("aria-label")) ?? ""));
}

test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

test("one hand, played through every interaction the table has", async ({
  page,
  baseURL,
  consoleErrors,
}) => {
  test.setTimeout(5 * 60_000);

  await resumeSaved(page, baseURL!, midHandSave());
  await settled(page, SETTLE_MS, TABLE);

  // --- arrange ---
  const before = await handOrder(page);
  // A set, not a sequence: which order the fan sorts a hand into is the engine's
  // to decide, and pinning it here would fail this spec for a sort change that
  // breaks no interaction.
  expect(new Set(before), "the seeded hand is what the fan draws").toEqual(new Set(VIEWER_SPOKEN));

  const first = await named(page, before[0]).boundingBox();
  const last = await named(page, before[before.length - 1]).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(PAST_HOLD_MS);
  await page.mouse.move(last!.x + last!.width + 40, first!.y + first!.height / 2, { steps: 16 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await settled(page, SETTLE_MS, TABLE);

  const arranged = await handOrder(page);
  expect(arranged, "arranging must not lose or duplicate a card").toHaveLength(before.length);
  expect(new Set(arranged), "arranging must not change which cards are held").toEqual(new Set(before));
  expect(arranged[arranged.length - 1], "the dragged card lands where the finger let go").toBe(
    before[0]
  );

  // --- select, and deselect ---
  await tap(page, named(page, TO_SELECT));
  expect(await selectedCard(page), "a tap selects the card it landed on, and only that one").toEqual([
    TO_SELECT,
  ]);

  await tap(page, named(page, TO_SELECT));
  expect(await selectedCard(page), "a second tap on a selected card puts it back down").toEqual([]);

  // --- play ---
  await tap(page, named(page, TO_PLAY));
  const gioca = page.getByTestId("btn-gioca");
  await expect(gioca, "the seeded hand beats the seeded pile, so GIOCA has to offer the play").
    toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout: 10_000 });
  await tap(page, gioca);

  await expect(
    page.locator(HAND_ZONE).getByRole("button", { name: TO_PLAY, exact: true }),
    "the card played leaves the hand"
  ).toHaveCount(0, { timeout: 15_000 });

  // --- select again, after a play ---
  //
  // The point of doing this here rather than above: a card's tap strip is
  // derived from the hand's size, so it is only after a play re-lays the fan out
  // that a stale strip can put this press on the neighbour. Named, not aimed —
  // a coordinate would follow the card and never notice (#683).
  await settled(page, SETTLE_MS, TABLE);
  await tap(page, named(page, AFTER_PLAY));
  expect(
    await selectedCard(page),
    "after a play, a press by name still selects the card that carries that name"
  ).toEqual([AFTER_PLAY]);
  await tap(page, named(page, AFTER_PLAY));

  // The same card again, pressed where a player presses it: the middle of the
  // art. `card-box` takes no hits of its own (`pointerEvents="none"`), so this
  // lands on whichever tap strip is under that point — which is the question a
  // stale strip gets wrong and an element-aimed press cannot ask, because that
  // one is delivered to the strip's own centre whatever the strip is doing.
  const art = await page
    .locator(`${HAND_CARDS}[aria-label="${AFTER_PLAY}"] [data-testid="card-box"]`)
    .boundingBox();
  expect(art, `the fan has to be drawing "${AFTER_PLAY}"`).not.toBeNull();
  await tapPoint(page, art!.x + art!.width / 2, art!.y + art!.height / 2);
  expect(
    await selectedCard(page),
    "a press in the middle of a card belongs to that card, not to its neighbour"
  ).toEqual([AFTER_PLAY]);
  await tapPoint(page, art!.x + art!.width / 2, art!.y + art!.height / 2);

  // --- pass ---
  //
  // Waited for, not assumed: the bot answers the play, and the viewer's turn
  // comes back with something on the felt that nothing left in this hand beats,
  // which is what makes passing the legal move rather than the convenient one.
  const passa = page.getByTestId("btn-passa");
  await expect(page.locator(TABLE), "the viewer's turn comes back").toHaveAttribute(
    TABLE_STATE,
    new RegExp(`^${YOUR_TURN_PREFIX}`),
    { timeout: 60_000 }
  );
  await expect(passa, "with a pile up and nothing to beat it, PASSA is the move").toBeEnabled({
    timeout: 15_000,
  });
  const heldBeforePass = (await handOrder(page)).length;
  const onTableBeforePass = cardsInHands((await page.locator(TABLE).getAttribute(TABLE_STATE)) ?? "");
  await tap(page, passa);

  // Cards still held, across every seat — the one number in the table's own
  // sentence that only a move can change. Whose turn it is says nothing here:
  // the bot answers fast enough that the turn can be back before an assertion
  // could read that it left.
  //
  // Well inside the AFK window, and that is the whole point of the number. This
  // seat is holding the hand up, so if the press did nothing the clock passes
  // for it after `MURLAN_AFK_TIMEOUT_MS` (30s, server/gameTimers.ts) and the
  // table moves on regardless — a longer wait here reports the timer working
  // rather than the button.
  await expect
    .poll(async () => cardsInHands((await page.locator(TABLE).getAttribute(TABLE_STATE)) ?? ""), {
      timeout: 10_000,
    })
    .toBeLessThan(onTableBeforePass!);
  await settled(page, SETTLE_MS, TABLE);
  expect((await handOrder(page)).length, "passing costs no cards").toBe(heldBeforePass);

  // --- and out, through the rest of the hand ---
  await driveGameToCompletion(page, {
    isFinished: async (p) => RESULT_URL.test(p.url()),
    log: (line) => test.info().annotations.push({ type: "move", description: line }),
  });
  await expect(page).toHaveURL(RESULT_URL);

  // --- exchange ---
  //
  // Seeded rather than played to. Which seat wins a manche is the bot's
  // business, so a spec that waits for the viewer to win one is a spec that
  // fails on the deal — and the exchange is a viewer interaction whether or not
  // this particular hand happened to reach it.
  await resumeSaved(page, baseURL!, exchangeSave());
  await expect(page.getByTestId("exchange-prompt"), "the exchange asks on the felt").toBeVisible({
    timeout: 15_000,
  });

  await tap(page, named(page, GIVEBACK));
  await tap(page, page.getByTestId("btn-gioca"));

  await expect(
    page.locator(HAND_ZONE).getByRole("button", { name: GIVEBACK, exact: true }),
    "the card picked is the one actually given away"
  ).toHaveCount(0, { timeout: 20_000 });

  expect(consoleErrors.entries, "no console errors across the whole hand").toEqual([]);
});
