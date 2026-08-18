import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import { driveHumansToGameOver, waitForRow, type RoomState } from "../helpers/gameDriver.ts";

/**
 * SEC-03: deleting an account mid-hand used to take the whole table's results
 * with it. The socket authenticated once at the handshake, so the deleted
 * account kept its seat, and the batch write at game over ran one transaction
 * for every player — the first insert for the missing id violated its foreign
 * key and rolled back everybody's stats, history and achievements.
 *
 * Its own file: `/api/auth/register` is limited per process and the suites
 * that already drive a table to game over sit at that ceiling.
 */

process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";

interface BotTakeover {
  userId: string;
  seatIndex: number;
  code?: string;
}

describe(
  "an account deleted mid-hand",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;
    let dbPool: pg.Pool;

    before(async () => {
      server = await startTestServer();
      dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    after(async () => {
      await dbPool.end();
      await server.stop();
    });

    test("loses its seat and its socket, and the rest of the table still gets its results", async () => {
      // The leaver hosts: deleting an account also deletes the rooms rows it
      // owns, which is the case where the seat is hardest to release.
      const leaver = await connectAs(server, "del_host_lek");
      const alice = await connectAs(server, "del_stay_alma");
      const bob = await connectAs(server, "del_stay_bekim");
      try {
        const created = waitFor<RoomState>(leaver.socket, "room:state");
        leaver.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 3 });
        const room = await created;
        for (const guest of [alice, bob]) {
          const joined = waitFor<RoomState>(guest.socket, "room:state");
          guest.socket.emit("room:join", { code: room.code });
          await joined;
        }

        const dealt = [leaver, alice, bob].map((c) => waitFor(c.socket, "game:state"));
        leaver.socket.emit("room:start");
        await Promise.all(dealt);

        const takeover = waitFor<BotTakeover>(alice.socket, "game:seat_bot_takeover", 5_000);
        const socketClosed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("the deleted account's socket was never closed")),
            5_000
          );
          leaver.socket.once("disconnect", () => {
            clearTimeout(timer);
            resolve();
          });
        });

        let deleteStatus = 0;
        const over = driveHumansToGameOver([alice.socket, bob.socket], () => {
          void (async () => {
            const res = await fetch(`${server.url}/api/users/me`, {
              method: "DELETE",
              headers: { cookie: leaver.cookie },
            });
            deleteStatus = res.status;
          })();
        });

        const seat = await takeover;
        assert.equal(seat.userId, leaver.user.id);
        assert.equal(seat.code, "PLAYER_LEFT_BOT_TAKEOVER");
        await socketClosed;

        await over;
        assert.equal(deleteStatus, 200, "the delete itself must still answer 200");

        for (const { user } of [alice, bob]) {
          const stats = await waitForRow(async () => {
            const res = await dbPool.query(
              "SELECT games_played FROM user_stats WHERE user_id = $1",
              [user.id]
            );
            return res.rows[0] ?? null;
          }, 10_000);
          assert.equal(
            Number(stats.games_played),
            1,
            `${user.username} played the hand out and must be credited with it`
          );

          const history = await waitForRow(async () => {
            const res = await dbPool.query(
              "SELECT placement FROM match_history WHERE user_id = $1",
              [user.id]
            );
            return res.rows[0] ?? null;
          }, 10_000);
          assert.ok(
            Number(history.placement) >= 1,
            `${user.username} must have a match_history row for the hand`
          );

          // The ladder is one transaction for the whole table by design, so
          // the seat that cannot be rated has to be dropped before it opens.
          const rating = await waitForRow(async () => {
            const res = await dbPool.query(
              "SELECT games FROM user_ratings WHERE user_id = $1",
              [user.id]
            );
            return res.rows[0] ?? null;
          }, 10_000);
          assert.equal(Number(rating.games), 1, `${user.username} must move on the ladder`);
        }

        const ghost = await dbPool.query(
          `SELECT 1 FROM user_stats WHERE user_id = $1
           UNION ALL SELECT 1 FROM match_history WHERE user_id = $1
           UNION ALL SELECT 1 FROM user_ratings WHERE user_id = $1`,
          [leaver.user.id]
        );
        assert.equal(ghost.rows.length, 0, "a deleted account is written nowhere");
      } finally {
        for (const client of [leaver, alice, bob]) client.socket.close();
      }
    });
  }
);
