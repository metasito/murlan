// `disposeGame`'s own docstring is "Drops every in-memory trace of a room", and
// the timer maps in server/game/gameTimers.ts are that trace. A timer left behind
// fires against a room that no longer exists — it deletes a `room_players` row
// for a table nobody is at, and the seat it frees belongs to whatever room has
// since taken the id.
//
// Written against every kind rather than one of them, so the next kind added to
// gameTimers.ts fails here until disposal clears it too.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { arm, pending, seatKey, TIMER_KINDS, type TimerKind } from "../../server/game/gameTimers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { disposeGame } from "../../server/game/gamePersistence.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";

const ROOM = "dispose-timers-room";
const SEATED = "dispose-timers-user";

/**
 * Enough of a table for the disposal path, which reads the roster and nothing
 * else. Cast through `unknown` deliberately: filling in the other fifteen
 * fields would say this test depends on them.
 */
function seatOneUser() {
  const roster = { roomId: ROOM, playerMap: { 0: SEATED } };
  activeGames.set(ROOM, roster as unknown as OnlineGameState);
}

/** How each kind is keyed; a kind missing here fails to compile. */
const KEY_OF: Record<TimerKind, string> = {
  afk: seatKey(ROOM, SEATED),
  disconnect: SEATED,
  lobbyGrace: seatKey(ROOM, SEATED),
  bot: ROOM,
  autoStart: ROOM,
  voteDeadline: ROOM,
};

describe("disposing a room", () => {
  test("leaves no timer of any kind behind", () => {
    seatOneUser();
    for (const kind of TIMER_KINDS) arm(kind, KEY_OF[kind], 60_000, () => {});
    assert.deepEqual(
      TIMER_KINDS.filter((kind) => !pending(kind, KEY_OF[kind])),
      [],
      "a kind was not armed, so its clearing proves nothing"
    );

    // `false`: the row is a database write, and what is under test is memory.
    disposeGame(ROOM, false);

    assert.deepEqual(
      TIMER_KINDS.filter((kind) => pending(kind, KEY_OF[kind])),
      [],
      "every timer keyed by a disposed room has to be cleared"
    );
    assert.equal(activeGames.has(ROOM), false);
  });
});
