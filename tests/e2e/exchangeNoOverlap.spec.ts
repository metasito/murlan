// tests/e2e/exchangeNoOverlap.spec.ts — the two exchanged cards never occupy
// the same space, and neither do the two labels that name what each seat got.
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

const card = (id: string, rank: string, suit: string) => ({ id, rank, suit, isJoker: false });

/** The viewer has just won a manche and is choosing what to hand back. */
function midExchangeSave() {
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

// #817: the owner's capture had "got 2 of Diamonds" rendered straight over the
// cards in his own hand — dark text on a card face, close to unreadable. The
// label used to sit at the trip's landing point, and for the viewer's own seat
// that point is the hand zone's own centre. Only a browser can say where either
// box ended up.
// The seat pairs a two-player table cannot reach are swept in
// tests/gameTableModel.test.ts, over every ordered pair at two window sizes:
// the diagonals are where the lane offset carries the label sideways as well as
// along, and this fixture has only the one trip between top and bottom.
test("neither seat's label lands on a card", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  {
    // A real phone in landscape: the window the labels went off the bottom of.
    await page.setViewportSize({ width: 844, height: 390 });
    await resumeSaved(page, baseURL!, midExchangeSave());

    await expect(page.getByTestId("exchange-prompt")).toBeVisible({ timeout: 15_000 });
    await tap(page, page.getByRole("button", { name: GIVEBACK_SPOKEN, exact: true }));
    await tap(page, page.getByTestId("btn-gioca"));

    // Both tags are mounted from the start and animate their opacity in, and
    // `toBeVisible` counts a fully transparent box as visible — so waiting on
    // that alone measures the prompt's own card, still mid-table, rather than
    // anything the flight did. The landing is what retires the fliers, so that
    // is what is waited for.
    const toWinner = page.getByTestId("exchange-tag-to-winner");
    const toLoser = page.getByTestId("exchange-tag-to-loser");
    await expect(page.getByTestId("exchange-prompt")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("exchange-flier-to-winner")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("exchange-flier-to-loser")).toHaveCount(0, { timeout: 15_000 });
    for (const tag of [toWinner, toLoser]) {
      await expect
        .poll(() => tag.evaluate((el) => Number(getComputedStyle(el).opacity)), {
          timeout: 15_000,
        })
        .toBeGreaterThan(0.9);
    }

    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="card-box"], [data-testid="card-box-back"]')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })
        .filter((r) => r.width > 0 && r.height > 0)
    );
    // The floor: with no cards measured the sweep below would pass having looked
    // at nothing, and the hand is exactly what the labels used to cover.
    expect(cards.length, "no card faces were measured at all").toBeGreaterThan(0);

    const window = page.viewportSize()!;
    for (const [name, tag] of [
      ["the winner's", toWinner],
      ["the loser's", toLoser],
    ] as const) {
      const box = (await tag.boundingBox())!;
      const on = cards.filter((c) => intersection(box, c) > 0);
      expect(
        on.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`),
        `${name} label sits on ${on.length} card face(s)`
      ).toEqual([]);

      // A label the table's own clip retired is a label that never said
      // anything — and it passes every overlap check ever written.
      expect(
        [
          box.x < 0 && "past the left edge",
          box.y < 0 && "above the top edge",
          box.x + box.width > window.width && "past the right edge",
          box.y + box.height > window.height && "below the bottom edge",
        ].filter(Boolean),
        `${name} label is at ${Math.round(box.x)},${Math.round(box.y)} ` +
          `(${Math.round(box.width)}x${Math.round(box.height)}) in a ` +
          `${window.width}x${window.height} window`
      ).toEqual([]);
    }

    // …and the two do not land on each other either, which the perpendicular
    // lane is what buys.
    expect(
      intersection((await toWinner.boundingBox())!, (await toLoser.boundingBox())!),
      "the two labels overlap each other"
    ).toBe(0);
  }
});
