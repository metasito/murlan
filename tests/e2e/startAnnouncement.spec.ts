// tests/e2e/startAnnouncement.spec.ts — the announcement of who opens the
// manche holds the table until it has been read, and the lamp points at it
// (#817).
//
// Two of the three claims are only answerable in a browser. Whether a layer
// actually covers a control is a hit-test — `document.elementFromPoint` at the
// button's own centre — and `react-test-renderer` runs no layout, so it has no
// point to test. Where the lamp is pointing is the felt anchor's laid-out
// position, which is a reanimated value: loops.md records that such a value is
// frozen at the mounting render in `props.style` and cannot be read back from a
// native test at all.
//
// tests/native/startAnnouncement.test.tsx pins the third claim — that the
// announcement cannot outlive the turn it names.
import { test, expect, type Page } from "@playwright/test";
import { resumeSaved } from "./helpers/offlineSeed";
import { RANK_SLOTS } from "../../lib/gameEngine";

const VIEWPORT = { width: 844, height: 390 };
/** How far off centre the lamp may sit and still be called centred. */
const CENTRE_TOLERANCE = 0.1;

/** A manche just dealt, opened by the viewer's own seat because it lost the last round. */
function openingSave() {
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
      startReason: { type: "lost_round", playerIdx: 0 },
      // Nothing played yet — the manche the `startReason` describes is still at
      // its opening, which is the whole condition for announcing it.
      playedRanks: Array.from({ length: RANK_SLOTS }, () => 0),
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

/** Whether the gate is what a finger would land on at this control's own centre. */
async function coveredByGate(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) throw new Error(`no ${id} on the table`);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top?.closest('[data-testid="start-reason-gate"]') !== null && top !== null;
  }, testId);
}

/** The lamp's own anchor point, as a fraction of the window. */
async function lampAt(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="felt-lamp-anchor"]');
    if (!el) throw new Error("the felt never drew a lamp");
    const r = el.getBoundingClientRect();
    return { x: r.x / window.innerWidth, y: r.y / window.innerHeight };
  });
}

/** The lamp swings; a read taken mid-swing is a read of the animation. */
async function settledLamp(page: Page): Promise<{ x: number; y: number }> {
  let previous = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const at = await lampAt(page);
    const key = `${at.x.toFixed(3)},${at.y.toFixed(3)}`;
    if (key === previous) return at;
    previous = key;
    await page.waitForTimeout(120);
  }
  throw new Error("the lamp never came to rest");
}

test("the opening announcement holds the table, and the lamp points at it", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VIEWPORT);
  await resumeSaved(page, baseURL!, openingSave());

  const gate = page.locator('[data-testid="start-reason-gate"]');
  await expect(gate).toBeVisible({ timeout: 15_000 });

  // Nothing the player could act with is reachable: both the play button and
  // the cards in hand answer to the gate rather than to themselves.
  expect(await coveredByGate(page, "btn-gioca"), "GIOCA is still tappable through the gate").toBe(
    true
  );
  expect(await coveredByGate(page, "card-box"), "a hand card is still tappable through it").toBe(
    true
  );

  // The owner's own remedy: the lamp is swung onto the middle, where the words
  // are, rather than sitting over the seat whose turn it happens to be.
  const held = await settledLamp(page);
  expect(Math.abs(held.x - 0.5), `the lamp sits at x ${held.x.toFixed(2)}`).toBeLessThan(
    CENTRE_TOLERANCE
  );
  expect(Math.abs(held.y - 0.5), `the lamp sits at y ${held.y.toFixed(2)}`).toBeLessThan(
    CENTRE_TOLERANCE
  );

  // One tap clears it — and is spent doing exactly that.
  await gate.click();
  await expect(gate).toHaveCount(0, { timeout: 15_000 });
  expect(await coveredByGate(page, "btn-gioca"), "GIOCA is still covered after the gate left").toBe(
    false
  );

  // …and the lamp goes back to the seat on move, which is the viewer's own.
  // The floor for the check above: if the lamp never moved at all, "centred"
  // would have been a fact about this table rather than about the gate.
  const released = await settledLamp(page);
  expect(
    released.y,
    `the lamp stayed at y ${released.y.toFixed(2)} instead of returning to the seat on move`
  ).toBeGreaterThan(0.5 + CENTRE_TOLERANCE);
});
