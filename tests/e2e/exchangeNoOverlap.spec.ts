// tests/e2e/exchangeNoOverlap.spec.ts — the two exchanged cards never occupy
// the same space.
//
// "both at the same time, one takes one side the other the other side they
// should not overlap" is the owner's own wording on #533, and it is the one
// claim about this animation no unit test can make: `exchangeFlight`'s
// arithmetic is checked in `tests/gameTableModel.test.ts`, but arithmetic says
// nothing about where two transformed views actually land — react-test-renderer
// never runs layout (docs/agents/loops.md). Only the browser knows.
//
// Sampled through the flight rather than at its end, because the closest the
// pair ever comes is the beat in the middle, and a frame taken after that beat
// would pass on a flight that had collided.
import { test, expect } from "./fixtures";
import { resumeSaved } from "./helpers/offlineSeed";
import { tap } from "./helpers/press";

const GIVEBACK_SPOKEN = "5 di Cuori";
/** Frames to take across the flight, and how long to wait between them. */
const SAMPLES = 24;
const SAMPLE_GAP_MS = 55;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Overlapping area, in px². Zero when the two only touch. */
function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function midExchangeSave() {
  const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });
  return {
    version: 2,
    gameState: {
      players: [
        {
          id: "player_0",
          name: "Ana",
          hand: [card("5_hearts", "5", "hearts"), card("K_spades", "K", "spades")],
          type: "human",
        },
        {
          id: "player_1",
          name: "Bea",
          hand: [card("J_hearts", "J", "hearts"), card("Q_diamonds", "Q", "diamonds")],
          type: "ai",
        },
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

test("the two exchanged cards fly at once and never overlap", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await resumeSaved(page, baseURL!, midExchangeSave());

  await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
  await tap(page, page.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }));
  await tap(page, page.getByTestId("btn-gioca"));

  const toWinner = page.getByTestId("exchange-flier-to-winner");
  const toLoser = page.getByTestId("exchange-flier-to-loser");
  await expect(toWinner).toBeVisible({ timeout: 15_000 });

  const frames: { a: Box; b: Box }[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // A short timeout, because `boundingBox` auto-waits for its element: the
    // fliers are gone the instant they land, and the default wait would spend
    // the whole test budget on the first sample past that.
    const a = await toWinner.boundingBox({ timeout: SAMPLE_GAP_MS }).catch(() => null);
    const b = await toLoser.boundingBox({ timeout: SAMPLE_GAP_MS }).catch(() => null);
    // The pair leaves together and lands together; a frame with only one of
    // them is the end of the flight, not a failure.
    if (a && b) frames.push({ a, b });
    await page.waitForTimeout(SAMPLE_GAP_MS);
  }

  // The floor: everything below is about frames, and no frames at all would
  // satisfy all of it.
  expect(frames.length, "the flight has to be sampled while it is running").toBeGreaterThan(4);

  const collided = frames
    .map((f, i) => ({ i, area: intersection(f.a, f.b), a: f.a, b: f.b }))
    .filter((f) => f.area > 0);

  expect(
    collided.map((f) => `frame ${f.i}: ${f.area.toFixed(0)}px² of overlap`),
    "the two cards are one trade, not one clump — they pass side by side"
  ).toEqual([]);

  // …and they really do travel, rather than sitting apart at their seats for
  // the whole flight, which would satisfy the assertion above trivially.
  const moved = Math.max(
    ...frames.map((f) => Math.hypot(f.a.x - frames[0].a.x, f.a.y - frames[0].a.y))
  );
  expect(moved, "the card has to cross the table, not stay at its seat").toBeGreaterThan(20);
});
