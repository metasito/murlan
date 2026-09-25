// tests/e2e/startAnnouncement.spec.ts — the announcement of who opens the
// manche holds the table until it has been read, and the lamp points at it
// (#817).
//
// Two of the three claims are only answerable in a browser. Whether a layer
// actually covers a control is a hit-test — `document.elementFromPoint` at the
// button's own centre — and `react-test-renderer` runs no layout, so it has no
// point to test. Where the lamp is pointing is the rig's shared value, read
// from the table's trace.
//
// tests/native/startAnnouncement.test.tsx pins the third claim — that the
// announcement cannot outlive the turn it names.
import { test, expect, type Page } from "@playwright/test";
import { resumeSaved } from "./helpers/offlineSeed";
import { tracedLamp } from "./helpers/tableTrace";
import { RANK_SLOTS } from "../../lib/game/gameEngine";
import { LIGHT_ABOVE, lampTarget, type LampTarget } from "../../components/table/lampRig";

// The design size, so the trace's felt points are the rig's own.
const VIEWPORT = { width: 874, height: 402 };

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

/** The pool the lamp throws, in design points. */
async function lampPool(page: Page): Promise<[number, number]> {
  const lamp = await tracedLamp(page);
  return [Math.round(lamp.x), Math.round(lamp.y + LIGHT_ABOVE)];
}

async function expectLampOver(page: Page, target: LampTarget, message: string): Promise<void> {
  await expect.poll(() => lampPool(page), { message, timeout: 10_000 }).toEqual([...lampTarget(target)]);
}

test("the opening announcement holds the table, and the lamp points at it", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await expectLampOver(page, "centre", "the lamp is not over the middle of the table");

  // One tap clears it — and is spent doing exactly that.
  await gate.click();
  await expect(gate).toHaveCount(0, { timeout: 15_000 });
  expect(await coveredByGate(page, "btn-gioca"), "GIOCA is still covered after the gate left").toBe(
    false
  );

  // …and the lamp goes back to the seat on move, which is the viewer's own.
  // The floor for the check above: if the lamp never moved at all, "centred"
  // would have been a fact about this table rather than about the gate.
  await expectLampOver(page, "bottom", "the lamp did not return to the seat on move");
});
