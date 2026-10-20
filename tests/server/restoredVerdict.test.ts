import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { handleRoundOver } from "../../server/game/roundOver.ts";
import { fromEnvelope, toEnvelope } from "../../server/game/tableState.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import type { GameMode, GameState, MatchLength, Player } from "../../lib/game/gameEngine.ts";

const ROOM = "room_verdict";

const { rt } = recordingRuntime();

function seat(id: string, team: "A" | "B" | undefined, handSize: number): Player {
  return {
    id,
    name: id,
    hand: Array.from({ length: handSize }, () => ({ rank: "3", suit: "spades" }) as never),
    type: "human",
    team,
  };
}

/** Seats 0/2 are team A, 1/3 team B; finishing 0,1,2,3 scores 3/2/1/0. */
function finishedRound(gameMode: GameMode): GameState {
  const team = (t: "A" | "B") => (gameMode === "teams" ? t : undefined);
  return {
    players: [seat("p0", team("A"), 0), seat("p1", team("B"), 0), seat("p2", team("A"), 0), seat("p3", team("B"), 3)],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode,
    trickWinner: null,
    roundOver: true,
    finishingOrder: ["p0", "p1", "p2", "p3"],
    firstPlayMade: true,
    lastMove: { seq: 0, kind: "deal" },
  };
}

async function foldAndRestore(spec: {
  gameMode: GameMode;
  matchLength?: MatchLength;
  scores: Record<string, number>;
  playerMap: Record<number, string>;
  vacatedSeats?: Map<number, { userId: string; username: string }>;
  botSeatsAtStart?: Set<number>;
}) {
  const game = onlineTable({
    roomId: ROOM,
    gameState: finishedRound(spec.gameMode),
    matchLength: spec.matchLength ?? "match",
    matchTarget: 21,
    playerMap: spec.playerMap,
    cumulativeScores: spec.scores,
    vacatedSeats: spec.vacatedSeats ?? new Map(),
    botSeatsAtStart: spec.botSeatsAtStart ?? new Set(),
  });
  await handleRoundOver(rt, ROOM, game);
  clearRoomTimers(ROOM);
  const back = fromEnvelope({ roomId: ROOM, gameState: JSON.parse(JSON.stringify(toEnvelope(game))) });
  assert.ok(back.ok, back.ok ? "" : back.reason);
  return { restored: back.game.matchOver, matchTarget: back.game.matchTarget };
}

const FOUR = { 0: "a1", 1: "b1", 2: "a2", 3: "b2" };

describe("the verdict the round's fold reached is the one a restored table has", () => {
  test("a teams pair that crossed the target only as a pair is over", async () => {
    const r = await foldAndRestore({ gameMode: "teams", scores: { a1: 11, b1: 5, a2: 9, b2: 4 }, playerMap: FOUR });
    assert.equal(r.restored, true);
  });

  test("the same totals in a free-for-all are still a running match", async () => {
    const r = await foldAndRestore({
      gameMode: "free_for_all",
      scores: { a1: 11, b1: 5, a2: 9, b2: 4 },
      playerMap: FOUR,
    });
    assert.equal(r.restored, false);
  });

  test("a teams pair short of the target is still running", async () => {
    const r = await foldAndRestore({ gameMode: "teams", scores: { a1: 9, b1: 5, a2: 5, b2: 4 }, playerMap: FOUR });
    assert.equal(r.restored, false);
  });

  test("a vacated partner's frozen points count towards the pair", async () => {
    const r = await foldAndRestore({
      gameMode: "teams",
      scores: { a1: 11, b1: 5, a2: 11, b2: 4 },
      playerMap: { 0: "a1", 1: "b1", 3: "b2" },
      vacatedSeats: new Map([[2, { userId: "a2", username: "A2" }]]),
    });
    assert.equal(r.restored, true);
  });

  test("a partner seat dealt to a bot counts towards the pair", async () => {
    const r = await foldAndRestore({
      gameMode: "teams",
      scores: { a1: 12, b1: 5, "bot:2": 10, b2: 4 },
      playerMap: { 0: "a1", 1: "b1", 3: "b2" },
      botSeatsAtStart: new Set([2]),
    });
    assert.equal(r.restored, true);
  });

  test("a single round is over once it is played", async () => {
    const r = await foldAndRestore({ gameMode: "teams", matchLength: "single", scores: {}, playerMap: FOUR });
    assert.equal(r.restored, true);
  });

  test("regression pin, never red: a teams tie at the target restores as running on the escalated target", async () => {
    const r = await foldAndRestore({ gameMode: "teams", scores: { a1: 11, b1: 12, a2: 9, b2: 10 }, playerMap: FOUR });
    assert.equal(r.restored, false);
    assert.ok(r.matchTarget > 21);
  });
});
