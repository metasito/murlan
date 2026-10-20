// tests/integration/takeoverSerialised.test.ts — two actions for one room in
// the same tick take the room over once, not twice (#613).
//
// The advisory lock keeps two *instances* off one room and cannot arbitrate two
// callers inside one: it is re-entrant within a session, so the second is told
// it holds the room without Postgres ever being asked
// (`server/game/gameOwnership.ts`'s `held`). `inFlight` is what serialises them, and
// this is the shape that proves it does.
//
// In process rather than over sockets, deliberately. The claim is about the
// order of two `await`s in one function, and a counted rehydrate is the direct
// observation of it — a socket round trip would put timing between the test and
// the thing being asserted, and a race that reproduces on a timer is a race
// that stops reproducing on a fast day.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { closeOwnership, ownershipKey, releaseRoom } from "../../server/game/gameOwnership.ts";
import { toEnvelope } from "../../server/game/tableState.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Long enough that a second racer entering the window is inside it, not after it. */
const RESTORE_MS = 40;

let restores = 0;

const table = (roomId: string) =>
  onlineTable({
    roomId,
    maxPlayers: 2,
    playerMap: { 0: "u1", 1: "u2" },
    gameState: startRound(
      ["u1", "u2"].map((name, i) => ({ name, type: "human" as const, id: `player_${i}` })),
      "free_for_all"
    ),
  });

/**
 * Every instance answers "not mine", which is the state the ticket is about: a
 * fresh process that owns nothing, with a persisted room to pick up. Both
 * players are online, so a restore arms no grace and sends nothing of its own:
 * each applied `resume` is then exactly one `game:turn_deadline`.
 */
const { rt: takeover, sent, cluster } = recordingRuntime({
  store: {
    games: {
      ...activeGameStore,
      load: async (roomId) => {
        restores += 1;
        // A restore is a database read; returning in the same tick would close
        // the window this test exists to enter.
        await sleep(RESTORE_MS);
        return { roomId, gameState: JSON.parse(JSON.stringify(toEnvelope(table(roomId)))) };
      },
    },
    rooms: { ...roomStore, getRoomById: async () => undefined as never },
  },
});
cluster.online = new Set(["u1", "u2"]);
const applies = (roomId: string) => sent.filter((e) => e.event === "game:turn_deadline" && "room" in e.to && e.to.room === roomId).length;

const resume = (roomId: string, userId: string): TableActionDraft => ({ kind: "resume", roomId, userId });

const start = (roomId: string, userId: string): TableActionDraft => ({
  kind: "startMatch",
  roomId,
  userId,
});

describe("two actions for one room in the same tick", () => {
  after(async () => {
    await closeOwnership();
  });

  test(
    "take it over once",
    { skip: hasDatabase() ? false : skipMessage() },
    async () => {
      const roomId = `takeover-${Date.now()}`;
      restores = 0;

      const [a, b] = await Promise.all([
        applyOrForward(takeover, resume(roomId, "u1")),
        applyOrForward(takeover, resume(roomId, "u2")),
      ]);

      assert.equal(restores, 1, "the room was restored more than once");
      // Both callers are still served — the loser waits for the takeover and
      // then finds the game in memory, rather than being refused.
      assert.equal(a.ok, true, "the first action was refused");
      assert.equal(b.ok, true, "the second action was refused");
      assert.equal(applies(roomId), 2, "an action was dropped rather than applied");

      clearRoomTimers(roomId);
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
        applyOrForward(takeover, start(roomId, "u1")),
        applyOrForward(takeover, start(roomId, "u2")),
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
      activeGames.set(roomId, table(roomId));
      restores = 0;

      await Promise.all([
        applyOrForward(takeover, resume(roomId, "u1")),
        applyOrForward(takeover, resume(roomId, "u2")),
      ]);

      assert.equal(restores, 0, "a resident room was restored over");

      clearRoomTimers(roomId);
      activeGames.delete(roomId);
    }
  );

  test(
    "a room locked by an instance that never answers is unreachable, not ownerless",
    { skip: hasDatabase() ? false : skipMessage() },
    async () => {
      const roomId = `unreachable-${Date.now()}`;
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      try {
        await holder.query("SELECT pg_advisory_lock($1::bigint)", [ownershipKey(roomId)]);
        restores = 0;
        const outcome = await applyOrForward(takeover, resume(roomId, "u1"));
        assert.equal(outcome.code, "TABLE_UNREACHABLE");
        assert.equal(restores, 0, "a room another session holds was restored here");
      } finally {
        await holder.end();
      }
    }
  );
});
