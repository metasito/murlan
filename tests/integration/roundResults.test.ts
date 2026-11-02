// tests/integration/roundResults.test.ts — a finished round's results land once (ADR 0014,
// decision 1): one transaction, cleared from the table's row by a fenced update, applied by
// whoever owns the table next when the process that finished it died first.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { eventually, register, waitFor, waitForWhere } from "../helpers/client.ts";
import { makeClients, setUpRoom } from "../helpers/table.ts";
import { driveRound } from "../helpers/gameDriver.ts";
import { pendingEntry, pendingRow, recordRound } from "../helpers/recordRound.ts";
import { holdRowLock } from "../helpers/userLock.ts";
import { commitRoundResults } from "../../server/game/roundResults.ts";
import { claimRoom, enterTable, ownsRoom, releaseRoom } from "../../server/game/gameOwnership.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { resumeOrphanedTables } from "../../server/game/tableLifecycle.ts";
import { installClock, realClock } from "../../server/http/clock.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import type { GameResult } from "../../lib/achievements.ts";
import type { RoundOverWriters } from "../../server/game/roundOver.ts";

process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

const seat = (userId: string, placement: number, playerCount = 2): GameResult => ({
  userId,
  placement,
  playerCount,
  playedBomb: false,
  playedJoker: false,
  matchWon: false,
  opponentsFinished: 0,
});

const A_MOVE = { seat: 0, combo: null, handCounts: [3, 4] };

describe("a finished round's results", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let rooms = 0;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  async function users(n: number, tag: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await register(server, `${tag}_${i}`)).user.id);
    return ids;
  }

  async function recorded(ids: string[]) {
    const [stats, history, ratings, replays] = await Promise.all([
      server.query<{ n: number }>("SELECT coalesce(sum(rounds_played), 0)::int AS n FROM user_stats WHERE user_id = ANY($1)", [ids]),
      server.query<{ n: number }>("SELECT count(*)::int AS n FROM round_history WHERE user_id = ANY($1)", [ids]),
      server.query<{ n: number }>("SELECT coalesce(sum(rounds), 0)::int AS n FROM user_ratings WHERE user_id = ANY($1)", [ids]),
      server.query<{ n: number }>("SELECT count(*)::int AS n FROM round_replays WHERE player_ids ?| $1", [ids]),
    ]);
    return { stats: stats[0]!.n, history: history[0]!.n, ratings: ratings[0]!.n, replays: replays[0]!.n };
  }

  /** A table this process owns, holding `entry` pending in its row: claimed, entered, as the table writers expect. */
  async function ownedTable(entry: ReturnType<typeof pendingEntry>): Promise<OnlineGameState> {
    const roomId = `results-room-${++rooms}`;
    await pendingRow(roomId, [entry]);
    assert.equal(await claimRoom(roomId), true);
    assert.equal((await enterTable(roomId)).held, true);
    return {
      roomId,
      gameState: { roundOver: false },
      pendingResults: [entry],
      landedResults: new Set([entry.round]),
    } as unknown as OnlineGameState;
  }

  test("applying the same round twice, the second after a commit whose answer was lost, lands it once", async () => {
    const ids = await users(2, "once");
    const entry = pendingEntry([seat(ids[0]!, 1), seat(ids[1]!, 2)], "free_for_all", new Date(), {
      seats: ids.map((userId, seatIndex) => ({ seatIndex, userId, vacatedBy: null, name: `p${seatIndex}` })),
      moves: [A_MOVE],
    });
    const game = await ownedTable(entry);
    try {
      const first = await server.rt.writers.applyPendingResults(game.roomId, game);
      assert.equal(first.failure, undefined);
      assert.notEqual(first.applied[0]?.ratings, null, "the first application commits");
      assert.deepEqual(await recorded(ids), { stats: 2, history: 2, ratings: 2, replays: 1 });

      // The commit landed, and this process never heard: the round is still pending in memory.
      game.pendingResults.push(entry);
      game.landedResults.add(entry.round);
      const second = await server.rt.writers.applyPendingResults(game.roomId, game);
      assert.equal(second.failure, undefined);
      assert.deepEqual(second.applied, [{ entry, ratings: null }], "found already applied");
      assert.deepEqual(game.pendingResults, []);
      assert.deepEqual(await recorded(ids), { stats: 2, history: 2, ratings: 2, replays: 1 }, "nothing applied twice");
      assert.equal(ownsRoom(game.roomId), true, "an applied round is not a lost table");
    } finally {
      await releaseRoom(game.roomId);
    }
  });

  test("an account deleted mid-round is skipped, and every other seat commits with it", async () => {
    const ids = await users(3, "deleted");
    await server.query("DELETE FROM users WHERE id = $1", [ids[1]]);
    const commit = await recordRound(
      [seat(ids[0]!, 1, 3), seat(ids[1]!, 2, 3), seat(ids[2]!, 3, 3)],
      "free_for_all",
      new Date()
    );
    assert.equal(commit.kind, "committed");
    assert.deepEqual(Object.keys(commit.kind === "committed" ? commit.ratings.ratingDeltas : {}).sort(), [ids[0], ids[2]].sort());
    assert.deepEqual(await recorded([ids[0]!, ids[2]!]), { stats: 2, history: 2, ratings: 2, replays: 0 });
    assert.deepEqual(await recorded([ids[1]!]), { stats: 0, history: 0, ratings: 0, replays: 0 });
  });

  test("a commit under an epoch the table has moved on from rolls back and applies nothing", async () => {
    const ids = await users(2, "stale");
    const roomId = `results-stale-${++rooms}`;
    const entry = pendingEntry([seat(ids[0]!, 1), seat(ids[1]!, 2)], "free_for_all", new Date(), {
      seats: ids.map((userId, seatIndex) => ({ seatIndex, userId, vacatedBy: null, name: `p${seatIndex}` })),
      moves: [A_MOVE],
    });
    const stale = await pendingRow(roomId, [entry]);
    const { epoch: current } = await activeGameStore.claim(roomId);
    try {
      assert.deepEqual(await commitRoundResults(activeGameStore, roomId, stale, entry, { markFinished: false }), { kind: "absent" });
      assert.deepEqual(await recorded(ids), { stats: 0, history: 0, ratings: 0, replays: 0 });
      const [row] = await server.query<{ n: number }>(
        "SELECT jsonb_array_length(game_state->'pendingResults')::int AS n FROM active_games WHERE room_id = $1",
        [roomId]
      );
      assert.equal(row?.n, 1, "the round stays pending for the table's owner");
    } finally {
      await server.query("DELETE FROM active_games WHERE room_id = $1 AND owner_epoch = $2", [roomId, current]);
    }
  });

  test("a round that ends at a month's end and commits after midnight is rated in the month it ended", async () => {
    const ids = await users(2, "season");
    const finishedAt = new Date("2031-01-31T23:59:59.500Z");
    const restore = installClock({ ...realClock, now: () => Date.parse("2031-02-01T00:00:03Z") });
    try {
      await recordRound([seat(ids[0]!, 1), seat(ids[1]!, 2)], "free_for_all", finishedAt);
    } finally {
      restore();
    }
    const rows = await server.query<{ season: string }>("SELECT DISTINCT season FROM user_ratings WHERE user_id = ANY($1)", [ids]);
    assert.deepEqual(rows, [{ season: "2031-01" }]);
  });

  test("the commit's statement count does not grow with the seats", async (t) => {
    const statementsFor = async (n: number) => {
      const ids = await users(n, `count${n}`);
      const roomId = `results-count-${++rooms}`;
      const entry = pendingEntry(
        ids.map((id, i) => ({ ...seat(id, i + 1, n), playedJoker: true })),
        "free_for_all",
        new Date(),
        { seats: ids.map((userId, seatIndex) => ({ seatIndex, userId, vacatedBy: null, name: `p${seatIndex}` })), moves: [A_MOVE] }
      );
      const epoch = await pendingRow(roomId, [entry]);
      const query = t.mock.method(pg.Client.prototype, "query");
      try {
        assert.equal((await commitRoundResults(activeGameStore, roomId, epoch, entry, { markFinished: true })).kind, "committed");
        return query.mock.callCount();
      } finally {
        query.mock.restore();
        await activeGameStore.remove(roomId, epoch);
      }
    };
    const two = await statementsFor(2);
    const four = await statementsFor(4);
    assert.equal(four, two, "every table is one multi-row statement");
    assert.ok(four <= 14, `${four} statements for four humans`);
  });

  /** Plays a 2-human round whose commit never runs, then drops the table as a crashed process would. */
  async function crashBeforeTheCommit(tag: string) {
    const clients = await makeClients(server, [`${tag}_a`, `${tag}_b`]);
    const room = await setUpRoom(clients, 2);
    const writers = server.rt.writers;
    const real = writers.applyPendingResults;
    writers.applyPendingResults = () => new Promise<never>(() => {});
    void driveRound(clients, () => clients[0]!.socket.emit("room:start"), { onExchange: "giveback", ms: 60_000 }).catch(() => {});
    try {
      await eventually(async () => {
        const [row] = await server.query<{ n: number }>(
          "SELECT coalesce(jsonb_array_length(game_state->'pendingResults'), 0)::int AS n FROM active_games WHERE room_id = $1",
          [room.roomId]
        );
        return (row?.n ?? 0) > 0;
      }, "the final write never carried the round", 30_000);
    } finally {
      writers.applyPendingResults = real;
    }
    activeGames.delete(room.roomId);
    clearRoomTimers(room.roomId);
    await releaseRoom(room.roomId);
    return { clients, roomId: room.roomId, ids: clients.map((c) => c.user.id), real };
  }

  async function pendingInRow(roomId: string): Promise<number> {
    const [row] = await server.query<{ n: number }>(
      "SELECT coalesce(jsonb_array_length(game_state->'pendingResults'), 0)::int AS n FROM active_games WHERE room_id = $1",
      [roomId]
    );
    return row?.n ?? 0;
  }

  test("a snapshot queued while the commit runs does not write the committed round back", async () => {
    const clients = await makeClients(server, ["snapshot_a", "snapshot_b"]);
    const room = await setUpRoom(clients, 2);
    const ids = clients.map((c) => c.user.id);
    const lock = await holdRowLock("SELECT id FROM users WHERE id = ANY($1) FOR NO KEY UPDATE", [ids]);
    try {
      const over = driveRound(clients, () => clients[0]!.socket.emit("room:start"), { onExchange: "giveback", ms: 60_000 });
      over.catch(() => {});
      await lock.waitForBlocked(1);
      const game = activeGames.get(room.roomId)!;
      assert.equal(game.pendingResults.length, 1, "the commit is waiting on the seats' locks");
      const snapshot = server.rt.writers.persistGameState(room.roomId, game);
      await lock.release();
      await over;
      await snapshot;
      assert.equal(await pendingInRow(room.roomId), 0, "the snapshot wrote the committed round back");
      assert.deepEqual(await recorded(ids), { stats: 2, history: 2, ratings: 2, replays: 1 });
    } finally {
      await lock.release();
      for (const c of clients) c.socket.close();
    }
  });

  test("a restart between the final write and the commit: the table commits the round before it serves anyone", async () => {
    const { clients, roomId, ids, real } = await crashBeforeTheCommit("restart");
    const writers: RoundOverWriters = server.rt.writers;
    const servedFirst: boolean[] = [];
    writers.applyPendingResults = (id, game) => {
      servedFirst.push(activeGames.has(id));
      return real(id, game);
    };
    try {
      const [bob] = clients.slice(1);
      const over = waitFor(bob!.socket, "game:round_over", 10_000);
      const state = waitForWhere(bob!.socket, "game:state", (s) => s.roundOver, 10_000);
      bob!.socket.emit("game:rejoin", { roomId });
      await state;
      assert.deepEqual(servedFirst, [false], "committed before the table was back in memory");
      assert.equal(Object.keys((await over).ratingDeltas).length, 2, "the rejoin hears the committed ratings");
      assert.deepEqual(await recorded(ids), { stats: 2, history: 2, ratings: 2, replays: 1 });
      assert.equal(await pendingInRow(roomId), 0, "the round is cleared from the row");
    } finally {
      writers.applyPendingResults = real;
      for (const c of clients) c.socket.close();
    }
  });

  test("a restart between the final write and the commit: the sweep commits it with nobody online", async () => {
    const { clients, roomId, ids } = await crashBeforeTheCommit("sweep");
    for (const c of clients) c.socket.close();
    await eventually(async () => (await server.rt.presence.connectedUserIds())?.size === 0, "the players never went offline");

    // As the sweeper's interval does: a pass that finds the table mid-disconnect leaves it to the next.
    await eventually(async () => {
      await resumeOrphanedTables(server.rt);
      return (await pendingInRow(roomId)) === 0;
    }, "the sweep never committed the round", 10_000);

    assert.deepEqual(await recorded(ids), { stats: 2, history: 2, ratings: 2, replays: 1 });
    assert.equal(await pendingInRow(roomId), 0);
    assert.equal(ownsRoom(roomId), false, "the sweep hands the table back");
    assert.equal(activeGames.has(roomId), false, "and wakes nothing");
  });
});
