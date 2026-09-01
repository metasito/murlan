// tests/e2e/playedHand.spec.ts — one hand, played through every interaction the
// table gives the viewer: select, deselect, arrange, play, pass, exchange.
//
// Every press is a real one — down, a finger's worth of time, up — because
// `click()` puts down and up in the same frame and a card answers both, which is
// what decides select against drag (tests/e2e/helpers/press.ts).
//
// A card is pressed twice over. `tap` is delivered to the element, so it reports
// which card owns a *name*; a press at the middle of the art is delivered to a
// point, so it reports which card owns the *screen* there. Those are two boxes
// on purpose — the pressable is the tap strip, and the card drawn inside it
// takes no hits of its own (components/CardView.tsx).
//
// Neither press catches a stale tap strip (#683); that wants a guard on the
// strip's own geometry, and it is #720.
//
// The hand size is load-bearing for a different reason, though, and it is why
// thirteen is written down rather than left to taste. `computeHandLayout` clamps
// the step between `MIN_READABLE_STEP` and `cardW * MAX_STEP_RATIO`, and at this
// viewport a hand of nine or fewer sits on the upper clamp — where playing a
// card moves the step by *zero*, so anything the fan's geometry decides is
// identical before and after and a spec asserting on it is green by
// construction. Thirteen is inside the window: the step moves 37.4 to 40.8.
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

/**
 * How long the table is given to answer the pass.
 *
 * Short on purpose, and the shortness is the assertion. This seat is on move, so
 * `HUMAN_TURN_SECONDS` (20s, app/game.tsx) is running and expiring it passes for
 * the seat — a dead button would then report as a working one to anything
 * waiting longer. The bot answers in well under a second with
 * `EXPO_PUBLIC_E2E_FAST` set, so this is several times what a healthy answer
 * needs and a small fraction of the clock it has to stay under. If it ever
 * flakes, it wants shortening, never lengthening.
 */
const PASS_ANSWER_MS = 5_000;

/** The reference handset, and the one every other table spec measures at. */
const PHONE = PHONES.find((p) => p.name === "iPhone 12")!;

const card = (id: string, rank: Rank, suit: Suit): Card => ({ id, rank, suit, isJoker: false });

// Total over `Suit`, so a card this file cannot name is a compile error rather
// than a card labelled "4 di undefined". The rendered fan is held against these
// below, which is what makes a locale edit fail here legibly.
const SPOKEN_SUIT: Record<NonNullable<Suit>, string> = {
  hearts: "Cuori",
  diamonds: "Quadri",
  clubs: "Fiori",
  spades: "Picche",
};
// A null suit is a joker, which speaks through its own key and is not dealt here.
const spoken = (c: Card) => `${c.rank} di ${SPOKEN_SUIT[c.suit!]}`;

const SUITS = ["hearts", "diamonds", "clubs"] as const;
const spread = (ranks: readonly Rank[]) =>
  ranks.flatMap((rank) => SUITS.map((suit) => card(`${rank}_${suit}`, rank, suit)));

// Numeric ranks throughout: a card's accessible name is its rank as printed only
// below the court cards, which speak through their own keys (lib/cardNames.ts).
const PILE_CARD = card("3_clubs", "3", "clubs");

/**
 * Thirteen cards, because that is what a seat is dealt and what the fan has to
 * lay out with real overlap.
 *
 * Every viewer card beats the pile and loses to every bot card, against Murlan's
 * order (3…10, J, Q, K, A, 2). That is what makes both moves below legal by
 * construction rather than by luck: the play cannot be refused, and the pass
 * cannot turn out to be a lead.
 */
const VIEWER_HAND = [...spread(["4", "5", "6", "7"]), card("8_hearts", "8", "hearts")];
const BOT_HAND = [...spread(["J", "Q", "K", "A"]), card("2_hearts", "2", "hearts")];
const VIEWER_SPOKEN = VIEWER_HAND.map(spoken);

const TO_PLAY = spoken(card("8_hearts", "8", "hearts"));
const TO_SELECT = spoken(card("6_clubs", "6", "clubs"));
const AFTER_PLAY = spoken(card("7_clubs", "7", "clubs"));
/** The same card, and deliberately: it is in the 3–10 the rules allow back (§10). */
const GIVEBACK = TO_SELECT;

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
    // One manche, not a match. `driveGameToCompletion` below plays out whatever
    // is left, and every manche after this one is dealt by a real shuffle — so a
    // match would put an unbounded, undealt tail inside a spec whose whole claim
    // is a deal it wrote down. `offlineMatch.spec.ts` is where a match belongs.
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

const seats = (viewer: Card[], bot: Card[]) => [
  { id: "player_0", name: "Ana", hand: viewer, type: "human" },
  { id: "player_1", name: "Bea", hand: bot, type: "ai" },
];

/**
 * The viewer on move with a single on the felt that their whole hand beats.
 *
 * The pile is built by the engine rather than written out: a combination carries
 * a strength the rules derive, and a hand-written one is a number this file
 * would have to keep in step with `getCombinationStrength`.
 */
const midHandSave = () =>
  save({
    players: seats(VIEWER_HAND, BOT_HAND),
    lastPlayedCombination: buildCombination([PILE_CARD]),
    lastPlayedBy: 1,
  });

/** The viewer as the manche's winner, choosing what to give back. */
const exchangeSave = () =>
  save({
    players: seats(VIEWER_HAND, BOT_HAND.slice(0, 2)),
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: card("2_spades", "2", "spades"),
      bothJokersException: false,
    },
  });

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

// Scoped to the hand, never to the table: the played pile renders real,
// correctly-labelled card buttons of its own, and an unscoped sweep takes those
// for playable cards (tests/e2e/helpers/selectors.ts).
const named = (page: Page, name: string) =>
  page.locator(HAND_ZONE).getByRole("button", { name, exact: true });

/**
 * Exactly `expected` is selected, and it is the card named.
 *
 * A count alone is satisfied by the wrong card being the one, which is the
 * failure this spec exists to catch. Both halves retry: `aria-pressed` is
 * written on a React commit that has not happened when the press returns.
 */
async function expectSelected(page: Page, expected: string | null) {
  if (expected) {
    await expect(named(page, expected), `"${expected}" is the card selected`).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
  await expect(
    page.locator(`${HAND_CARDS}[aria-pressed="true"]`),
    expected ? `only "${expected}" is selected` : "nothing is left selected"
  ).toHaveCount(expected ? 1 : 0);
  // Selecting lifts the card, and a press aimed at a moving element waits for it
  // to hold still and then gives up. The next press in this file is always this
  // one's undo, so the wait belongs here rather than at each call.
  await settled(page, SETTLE_MS, HAND_ZONE);
}

/** The centre of a card's art, read fresh — a selected card lifts out of a stale box. */
async function artCentre(page: Page, name: string) {
  const box = await named(page, name).locator('[data-testid="card-box"]').boundingBox();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

const tableState = async (page: Page) => (await page.locator(TABLE).getAttribute(TABLE_STATE)) ?? "";

test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

test("one hand, played through every interaction the table has", async ({ page, baseURL }) => {
  test.setTimeout(5 * 60_000);

  await resumeSaved(page, baseURL!, midHandSave());
  await settled(page, SETTLE_MS, TABLE);

  // --- arrange ---
  const before = await handOrder(page);
  expect(before, "the seeded hand is what the fan draws").toHaveLength(VIEWER_SPOKEN.length);
  expect(new Set(before), "the seeded hand is what the fan draws").toEqual(new Set(VIEWER_SPOKEN));

  const first = (await named(page, before[0]).boundingBox())!;
  const last = (await named(page, before[before.length - 1]).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(PAST_HOLD_MS);
  await page.mouse.move(last.x + last.width + 40, first.y + first.height / 2, { steps: 16 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await settled(page, SETTLE_MS, TABLE);

  const arranged = await handOrder(page);
  expect(arranged, "arranging must not lose or duplicate a card").toHaveLength(before.length);
  expect(new Set(arranged), "arranging must not change which cards are held").toEqual(
    new Set(before)
  );
  expect(arranged[arranged.length - 1], "the dragged card lands where the finger let go").toBe(
    before[0]
  );

  // --- select, and deselect ---
  await tap(page, named(page, TO_SELECT));
  await expectSelected(page, TO_SELECT);
  await tap(page, named(page, TO_SELECT));
  await expectSelected(page, null);

  // --- play ---
  await tap(page, named(page, TO_PLAY));
  await expect(
    page.getByTestId("btn-gioca"),
    "the seeded hand beats the seeded pile, so GIOCA has to offer the play"
  ).toHaveAttribute("aria-label", GIOCA_VALID_LABEL, { timeout: 10_000 });
  await tap(page, page.getByTestId("btn-gioca"));
  await expect(named(page, TO_PLAY), "the card played leaves the hand").toHaveCount(0, {
    timeout: 15_000,
  });

  // --- select again, after a play ---
  await settled(page, SETTLE_MS, TABLE);
  await tap(page, named(page, AFTER_PLAY));
  await expectSelected(page, AFTER_PLAY);
  await tap(page, named(page, AFTER_PLAY));
  await expectSelected(page, null);

  // The same card, pressed where a player presses it: the middle of the art.
  // `card-box` takes no hits of its own, so the point lands on whichever strip
  // covers it. Both boxes are re-read, because a selected card lifts.
  const centre = await artCentre(page, AFTER_PLAY);
  await tapPoint(page, centre.x, centre.y);
  await expectSelected(page, AFTER_PLAY);
  const lifted = await artCentre(page, AFTER_PLAY);
  await tapPoint(page, lifted.x, lifted.y);
  await expectSelected(page, null);

  // --- pass ---
  await expect(page.locator(TABLE), "the viewer's turn comes back").toHaveAttribute(
    TABLE_STATE,
    new RegExp(`^${YOUR_TURN_PREFIX}`),
    { timeout: 60_000 }
  );
  const passa = page.getByTestId("btn-passa");
  await expect(passa, "with a pile up and nothing to beat it, PASSA is the move").toBeEnabled({
    timeout: 15_000,
  });

  const heldBeforePass = (await handOrder(page)).length;
  const onTableBeforePass = cardsInHands(await tableState(page));
  expect(onTableBeforePass, "the table has to be announcing its hand sizes").not.toBeNull();
  await tap(page, passa);

  // Cards held across every seat, which only a move changes. Whose turn it is
  // says nothing: the bot answers before an assertion could read that the turn
  // left. What this is really asserting is the *deadline* — see PASS_ANSWER_MS.
  await expect
    .poll(async () => cardsInHands(await tableState(page)) ?? onTableBeforePass!, {
      timeout: PASS_ANSWER_MS,
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
  // Seeded rather than played to: which seat wins a manche is the bot's
  // business, so a spec that waits for the viewer to win one fails on the deal.
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
});
