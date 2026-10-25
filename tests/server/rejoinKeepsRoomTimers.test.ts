// tests/server/rejoinKeepsRoomTimers.test.ts — re-arming a turn clears the turn's own timers and no other kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { armTurnIfIdle } from "../../server/game/gameTurn.ts";
import { arm, clear, pending, seatKey, TIMER_KINDS, type TimerKind } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { startRound } from "../../lib/game/gameEngine.ts";

const ROOM = "rejoin-keeps-room-timers";
const USER = "u-away";
const { rt } = recordingRuntime();

const TURN_KINDS: ReadonlySet<TimerKind> = new Set(["afk", "bot"]);
const NON_TURN = TIMER_KINDS.filter((kind) => !TURN_KINDS.has(kind));

const keysFor = (kind: TimerKind) => (kind === "disconnect" ? [USER] : [ROOM, seatKey(ROOM, USER)]);

/** The kinds a rejoin onto an idle bot table cleared, of those planted beforehand. */
function clearedByRejoin(planted: readonly TimerKind[]): TimerKind[] {
  const restoreClock = installClock(fakeClock());
  const seats = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "bot" as const, id: `player_${i}` }));
  activeGames.set(ROOM, { roomId: ROOM, gameState: startRound(seats, "free_for_all"), playerMap: {} } as unknown as OnlineGameState);
  try {
    for (const kind of planted) for (const key of keysFor(kind)) arm(kind, key, 60_000, () => {});
    armTurnIfIdle(rt, ROOM);
    assert.ok(pending("bot", ROOM), "the rejoin never reached armTurn, so nothing was tested");
    return planted.filter((kind) => keysFor(kind).some((key) => !pending(kind, key)));
  } finally {
    for (const kind of TIMER_KINDS) for (const key of keysFor(kind)) clear(kind, key);
    activeGames.delete(ROOM);
    restoreClock();
  }
}

test("a rejoin through armTurnIfIdle clears no timer that is not the turn's", () => {
  assert.ok(NON_TURN.length >= 4 && NON_TURN.includes("voteDeadline") && NON_TURN.includes("autoStart"), `planted only ${NON_TURN.join(", ")}`);
  assert.deepEqual(clearedByRejoin(NON_TURN), []);
});

test("probe: a turn kind planted beside them is seen cleared", () => {
  assert.deepEqual(clearedByRejoin([...NON_TURN, "afk"]), ["afk"]);
});
