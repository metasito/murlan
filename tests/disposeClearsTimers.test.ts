// `disposeGame`'s own docstring is "Drops every in-memory trace of a room", and
// the timer maps in server/gameTimers.ts are that trace. A timer left behind
// fires against a room that no longer exists — it deletes a `room_players` row
// for a table nobody is at, and the seat it frees belongs to whatever room has
// since taken the id.
//
// Written against the maps rather than one of them, so the next map added to
// gameTimers.ts fails here until disposal clears it too.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  afkTimers,
  botTimers,
  disconnectTimers,
  lobbyGraceTimers,
  lobbyGraceKey,
} from "../server/gameTimers.ts";
import { activeGames } from "../server/gameRoom.ts";
import { disposeGame } from "../server/gamePersistence.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";

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

/** A timer of each kind, keyed the way its own map keys them. */
function armOneOfEach() {
  const idle = () => setTimeout(() => {}, 60_000);
  afkTimers.set(`${ROOM}:${SEATED}`, idle());
  botTimers.set(ROOM, idle());
  disconnectTimers.set(SEATED, idle());
  lobbyGraceTimers.set(lobbyGraceKey(ROOM, SEATED), idle());
}

describe("disposing a room", () => {
  test("leaves no timer of any kind behind", () => {
    seatOneUser();
    armOneOfEach();

    // `false`: the row is a database write, and what is under test is memory.
    disposeGame(ROOM, false);

    const left = [
      ["afk", [...afkTimers.keys()].filter((k) => k.startsWith(`${ROOM}:`))],
      ["bot", [...botTimers.keys()].filter((k) => k === ROOM)],
      ["disconnect", [...disconnectTimers.keys()].filter((k) => k === SEATED)],
      ["lobby grace", [...lobbyGraceTimers.keys()].filter((k) => k.startsWith(`${ROOM}:`))],
    ] as const;

    assert.deepEqual(
      left.filter(([, keys]) => keys.length > 0).map(([kind]) => kind),
      [],
      "every timer map keyed by a disposed room has to be empty"
    );
    assert.equal(activeGames.has(ROOM), false);
  });
});
