// tests/integration/takeoverSerialised.test.ts — two actions for one room in
// the same tick take the room over once, not twice (#613).
//
// The advisory lock keeps two *instances* off one room and cannot arbitrate two
// callers inside one: it is re-entrant within a session, so the second is told
// it holds the room without Postgres ever being asked
// (`server/gameOwnership.ts`'s `held`). `inFlight` is what serialises them, and
// this is the shape that proves it does.
//
// In process rather than over sockets, deliberately. The claim is about the
// order of two `await`s in one function, and a counted rehydrate is the direct
// observation of it — a socket round trip would put timing between the test and
// the thing being asserted, and a race that reproduces on a timer is a race
// that stops reproducing on a fast day.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { applyOrForward, setTableHandlers } from "../../server/tableRouter.ts";
import { activeGames } from "../../server/gameRoom.ts";
import { closeOwnership, releaseRoom } from "../../server/gameOwnership.ts";
import type { OnlineGameState } from "../../server/gameRoom.ts";
import type { TableAction, TableActionDraft } from "../../server/tableActions.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Long enough that a second racer entering the window is inside it, not after it. */
const RESTORE_MS = 40;

let restores = 0;
let applies = 0;

/**
 * Every instance answers "not mine", which is the state the ticket is about: a
 * fresh process that owns nothing, with a persisted room to pick up.
 */
const io = {
  serverSideEmit: (_event: string, _action: TableAction, cb: (e: unknown, r: unknown[]) => void) =>
    cb(null, []),
} as unknown as SocketServer;

const play = (roomId: string, userId: string): TableActionDraft => ({
  kind: "play",
  roomId,
  userId,
  username: userId,
  cardIds: [],
});

const start = (roomId: string, userId: string): TableActionDraft => ({
  kind: "startMatch",
  roomId,
  userId,
  username: userId,
});

describe("two actions for one room in the same tick", () => {
  before(() => {
    setTableHandlers(
      async () => {
        applies += 1;
        return { ok: true };
      },
      async (roomId) => {
        restores += 1;
        // A restore is a database read; returning in the same tick would close
        // the window this test exists to enter.
        await sleep(RESTORE_MS);
        activeGames.set(roomId, {} as OnlineGameState);
        return "restored";
      }
    );
  });

  after(async () => {
    await closeOwnership();
  });

  test(
    "take it over once",
    { skip: hasDatabase() ? false : skipMessage() },
    async () => {
      const roomId = `takeover-${Date.now()}`;
      restores = 0;
      applies = 0;

      const [a, b] = await Promise.all([
        applyOrForward(io, play(roomId, "u1")),
        applyOrForward(io, play(roomId, "u2")),
      ]);

      assert.equal(restores, 1, "the room was restored more than once");
      // Both callers are still served — the loser waits for the takeover and
      // then finds the game in memory, rather than being refused.
      assert.equal(a.ok, true, "the first action was refused");
      assert.equal(b.ok, true, "the second action was refused");
      assert.equal(applies, 2, "an action was dropped rather than applied");

      activeGames.delete(roomId);
      await releaseRoom(roomId);
    }
  );

  test(
    "deal once, however many players press start",
    { skip: hasDatabase() ? false : skipMessage() },
    async () => {
      // `startMatch` is the only `create` kind, and the only action that deals.
      // Two deals for one table is the worst outcome in this window: the second
      // hand overwrites the first while both are in play.
      const roomId = `start-${Date.now()}`;
      restores = 0;

      await Promise.all([
        applyOrForward(io, start(roomId, "u1")),
        applyOrForward(io, start(roomId, "u2")),
      ]);

      assert.equal(restores, 1, "the table was dealt more than once");

      activeGames.delete(roomId);
      await releaseRoom(roomId);
    }
  );

  test(
    "a room already in memory is never taken over at all",
    { skip: hasDatabase() ? false : skipMessage() },
    async () => {
      const roomId = `resident-${Date.now()}`;
      activeGames.set(roomId, {} as OnlineGameState);
      restores = 0;

      await Promise.all([
        applyOrForward(io, play(roomId, "u1")),
        applyOrForward(io, play(roomId, "u2")),
      ]);

      assert.equal(restores, 0, "a resident room was restored over");

      activeGames.delete(roomId);
    }
  );
});
