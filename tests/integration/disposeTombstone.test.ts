// A disposed table's row is gone for good: no later write of that game brings it back, and no
// instance — this one included — can claim the room while the row it would restore still exists.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { Player } from "../../lib/game/gameEngine.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const player = (id: string, name: string): Player => ({ id, name, hand: [], type: "human" });

function liveGame(roomId: string): OnlineGameState {
  return {
    roomId,
    joinCode: "TOMBST",
    gameState: {
      players: [player("player_0", "Ana"), player("player_1", "Besi")],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      roundOver: false,
      finishingOrder: [],
      firstPlayMade: true,
    },
    playerMap: { 0: "ana", 1: "besi" },
    rematchVotes: new Set(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 2,
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 0,
    matchOver: false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: null,
  } as unknown as OnlineGameState;
}

describe("a disposed table", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let observer: pg.Client;

  before(async () => {
    server = await startTestServer();
    observer = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await observer.connect();
  });

  after(async () => {
    await observer.end();
    await server.stop();
  });

  test("stays disposed: its row is deleted before the lock goes, and never written again", async () => {
    const { activeGames } = await import("../../server/game/gameRoom.ts");
    const { disposeGame, persistGameState } = await import("../../server/game/gamePersistence.ts");
    const { activeGameStore } = await import("../../server/store/activeGameStore.ts");
    const { claimRoom, ownershipKey } = await import("../../server/game/gameOwnership.ts");
    const roomId = `tombstone-${Date.now()}`;
    const key = ownershipKey(roomId);
    const rowExists = async () =>
      (await observer.query("SELECT 1 FROM active_games WHERE room_id = $1", [roomId])).rowCount === 1;
    const lockFree = async () => {
      const { rows } = await observer.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [key]
      );
      if (rows[0].locked) await observer.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
      return rows[0].locked;
    };

    const game = liveGame(roomId);
    assert.equal(await claimRoom(roomId), true);
    activeGames.set(roomId, game);
    await persistGameState(roomId, game);
    assert.equal(await rowExists(), true);

    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => (entered = resolve));
    const real = activeGameStore.write;
    activeGameStore.write = async (...args) => {
      entered();
      await gate;
      return real.apply(activeGameStore, args);
    };
    try {
      const held = persistGameState(roomId, game);
      await writing;
      disposeGame(roomId);
      await sleep(200);

      assert.equal(await claimRoom(roomId), false, "the room was claimed again while its row was still being deleted");
      assert.equal(await lockFree(), false, "the lock went while the row it guards was still there");

      void persistGameState(roomId, game);
      open();
      await held;
    } finally {
      activeGameStore.write = real;
    }

    const deadline = Date.now() + 5_000;
    while (!(await lockFree())) {
      assert.ok(Date.now() < deadline, "the room was never handed back");
      await sleep(50);
    }
    await sleep(200);
    assert.equal(await rowExists(), false, "a write from the disposed table brought its row back");
  });
});
