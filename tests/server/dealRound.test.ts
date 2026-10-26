import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { dealRound } from "../../server/game/dealRound.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { arm, clearRoomTimers, pending } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { castEndMatchVote } from "../../server/game/seatLedger.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "deal-round-room";
const SEATS = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));

let restoreClock = () => {};

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  restoreClock();
});

async function dealOnto(overrides: Partial<OnlineGameState>) {
  restoreClock = installClock(fakeClock());
  const { rt, events } = recordingRuntime();
  const game = onlineTable({ roomId: ROOM, gameState: startRound(SEATS, "free_for_all"), ...overrides });
  activeGames.set(ROOM, game);
  await dealRound(rt, game, startRound(SEATS, "free_for_all"));
  return { game, events };
}

test("a deal forgets the last round's flags", async () => {
  const { game } = await dealOnto({ roundFlags: { 2: { bomb: true, joker: true } } });
  assert.deepEqual(game.roundFlags, {});
});

test("a deal starts the new round's move log empty", async () => {
  const { game } = await dealOnto({ moveLog: [{} as never, {} as never] });
  assert.deepEqual(game.moveLog, []);
});

test("a deal after a finished match starts the next match from nothing", async () => {
  const { game, events } = await dealOnto({
    matchOver: true,
    roundsPlayed: 5,
    cumulativeScores: { a: 40, b: 12 },
  });
  assert.equal(game.matchOver, false);
  assert.equal(game.roundsPlayed, 0);
  assert.deepEqual(game.cumulativeScores, {});
  const [state] = events("game:match_state") as { roundsPlayed: number; scores: Record<string, number> }[];
  assert.equal(state?.roundsPlayed, 0);
  assert.deepEqual(Object.values(state?.scores ?? {}), [0, 0, 0, 0]);
});

test("a deal tells the room the round started and what the match stands at", async () => {
  const { events } = await dealOnto({ roundsPlayed: 2, matchTarget: 15, cumulativeScores: { "bot:1": 6 } });
  assert.equal(events("game:started").length, 1);
  const states = events("game:match_state") as { target: number; roundsPlayed: number; scores: Record<string, number> }[];
  assert.equal(states.length, 1);
  assert.equal(states[0]?.target, 15);
  assert.equal(states[0]?.roundsPlayed, 2);
  assert.equal(states[0]?.scores["player_1"], 6);
});

test("a deal clears the room's other timers and arms the new round's first turn", async () => {
  restoreClock = installClock(fakeClock());
  const { rt } = recordingRuntime();
  const game = onlineTable({ roomId: ROOM, gameState: startRound(SEATS, "free_for_all") });
  activeGames.set(ROOM, game);
  arm("voteDeadline", ROOM, 30_000, () => {});
  arm("autoStart", ROOM, 4_000, () => {});

  await dealRound(rt, game, startRound(SEATS, "free_for_all"));

  assert.equal(pending("voteDeadline", ROOM), false, "last round's vote deadline outlived the deal");
  assert.equal(pending("autoStart", ROOM), false, "a pending auto-start outlived the deal");
  assert.equal(pending("bot", ROOM), true, "nobody was set to play the opening turn");
});

test("a deal leaves no walkout, weak seat or end-match vote of the last round standing", async () => {
  restoreClock = installClock(fakeClock());
  const { rt } = recordingRuntime();
  const game = onlineTable({
    roomId: ROOM,
    gameState: startRound(SEATS, "free_for_all"),
    weakSeats: new Set([2]),
    abandonedSeats: new Map([[1, "bob"]]),
  });
  castEndMatchVote(game, "carl", true);
  activeGames.set(ROOM, game);

  await dealRound(rt, game, startRound(SEATS, "free_for_all"));

  assert.equal(game.weakSeats.size, 0);
  assert.equal(game.abandonedSeats.size, 0);
  assert.equal(game.endMatchVotes.size, 0);
});
