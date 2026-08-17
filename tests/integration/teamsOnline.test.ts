// tests/integration/teamsOnline.test.ts — the online 2v2 path.
//
// tests/teams.test.ts already covers the scoring arithmetic in isolation. What
// it cannot reach is the wiring: that `room:start` actually seats partners
// opposite each other, that a four-human teams table plays to a finish without
// deadlocking, and that the ranked ladder stays out of it — a teams placement
// belongs to the pair, so rating individuals from it needs a model the ladder
// does not have (see lib/rating.ts).
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
import type { Socket } from "socket.io-client";
import {
  driveHumansToGameOver,
  waitForRow,
  type RoomState,
  type SanitizedState,
} from "../helpers/gameDriver.ts";

process.env.MURLAN_AFK_TIMEOUT_MS = "300";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

/** Seats carry their team once the engine has dealt; the sanitiser passes it through. */
interface TeamedState extends SanitizedState {
  players: (SanitizedState["players"][number] & { team?: "A" | "B" })[];
}

describe("online teams mode", { skip: hasDatabase() ? false : skipMessage() }, () => {
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

  test("partners sit opposite, the table finishes, and nothing is rated", async () => {
    const clients: { socket: Socket; user: { id: string }; cookie: string }[] = [];
    for (const name of ["team_a1", "team_b1", "team_a2", "team_b2"]) {
      clients.push(await connectAs(server, name));
    }

    try {
      const created = waitFor<RoomState>(clients[0].socket, "room:state");
      clients[0].socket.emit("room:create", { gameMode: "teams", maxPlayers: 4 });
      let room = await created;
      for (const guest of clients.slice(1)) {
        const joined = waitFor<RoomState>(guest.socket, "room:state");
        guest.socket.emit("room:join", { code: room.code });
        room = await joined;
      }

      const firstState = waitFor<TeamedState>(clients[0].socket, "game:state");
      const over = driveHumansToGameOver(
        clients.map((c) => c.socket),
        () => clients[0].socket.emit("room:start"),
        120_000
      );

      // docs/RULES.md §11: partners sit across from each other, so the teams
      // alternate around the table. Seating them adjacently would make the
      // pair's turn order consecutive and change the game entirely.
      const state = await firstState;
      assert.deepEqual(
        state.players.map((p) => p.team),
        ["A", "B", "A", "B"]
      );

      const payload = (await over) as { scores: { username: string; total: number }[] };
      assert.ok(payload, "a four-human teams table must reach game:over");
      assert.equal(payload.scores.length, 4);

      for (const { user } of clients) {
        const row = await waitForRow(async () => {
          const res = await dbPool.query(
            "SELECT game_mode, player_count FROM match_history WHERE user_id = $1",
            [user.id]
          );
          return res.rows[0] ?? null;
        });
        assert.equal(row.game_mode, "teams");
        assert.equal(Number(row.player_count), 4);
      }

      // A teams hand is still worth watching back, so the replay write does run
      // here. Waiting for it is also what keeps this test honest: it finishes in
      // under a second, and tearing the server down while game-over's
      // fire-and-forget writes are still in flight would cut them off mid-query.
      const replay = await waitForRow(async () => {
        const res = await dbPool.query(
          "SELECT game_mode, seats FROM match_replays WHERE player_ids @> $1::jsonb",
          [JSON.stringify([clients[0].user.id])]
        );
        return res.rows[0] ?? null;
      });
      assert.equal(replay.game_mode, "teams");
      assert.equal((replay.seats as unknown[]).length, 4);

      // The ladder is free-for-all only, by decision rather than by omission.
      // Every other write from the same game-over block has landed by now, so
      // the rating write has had its chance and declined.
      const rated = await dbPool.query(
        "SELECT 1 FROM user_ratings WHERE user_id = ANY($1)",
        [clients.map((c) => c.user.id)]
      );
      assert.equal(rated.rows.length, 0, "a teams result must not move anyone's rating");
    } finally {
      for (const c of clients) c.socket.close();
    }
  });
});
