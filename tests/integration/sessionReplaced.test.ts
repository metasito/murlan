import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import {
  setUpRoom,
  startGame,
  driveHandToExchangeOrOver,
  assertHandSecrecy,
  type Client,
  type RoomState,
  type SanitizedState,
} from "../helpers/table.ts";

/**
 * NET-06 / decision D5: one live socket per account. A second connection takes
 * the account, and the socket it replaces is told so and closed.
 *
 * What the fix is really for is the *table*: the replaced socket's disconnect
 * must not look like the player dropping. Before this, the second tab silently
 * stole every broadcast, and closing it announced the first player as
 * disconnected and handed their seat to a bot while they sat watching a table
 * that had stopped updating.
 *
 * Its own file: `/api/auth/register` is limited per process and the suites that
 * already seat a table sit at that ceiling.
 *
 * `server/socket.ts` reads these once at module scope, and `node --test` gives
 * this file its own process. The grace is deliberately short — if the eviction
 * ever did arm it, the bot takeover lands inside the window this test watches.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "5000";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
process.env.MURLAN_BOT_MOVE_DELAY_MS = "20";

const GRACE_MS = 500;

interface SocketError {
  code?: string;
  message?: string;
}

describe(
  "a second connection for one account",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer();
    });

    after(async () => {
      await server.stop();
    });

    /**
     * Another socket for an account that already registered. `connectAs` would
     * register a new user, and the register route is rate limited per process,
     * so the session cookie is reused for a fresh ticket instead.
     */
    async function openSecondSocket(cookie: string): Promise<Socket> {
      const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
        method: "POST",
        headers: { cookie },
      });
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const { ticket } = JSON.parse(text) as { ticket: string };

      const socket = ioClient(server.url, {
        auth: { ticket },
        transports: ["websocket"],
        reconnection: false,
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", (e) => reject(e));
      });
      return socket;
    }

    test("evicts the first with SESSION_REPLACED and leaves the seat alone", async () => {
      const alice = await connectAs(server, "sess_repl_alma");
      const bob = await connectAs(server, "sess_repl_bekim");
      let second: Socket | null = null;
      try {
        const room: RoomState = await setUpRoom([alice, bob], 2);
        await startGame([alice, bob]);

        // The two things the table must never be told. Collected for the whole
        // test rather than asserted once: a takeover that arrives late is the
        // same bug as one that arrives early.
        const announced: string[] = [];
        for (const event of ["game:player_disconnected", "game:seat_bot_takeover"]) {
          bob.socket.on(event, () => announced.push(event));
        }

        const evicted = waitFor<SocketError>(alice.socket, "socket:error");
        const closed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("the replaced socket was never closed")),
            5_000
          );
          alice.socket.once("disconnect", () => {
            clearTimeout(timer);
            resolve();
          });
        });

        second = await openSecondSocket(alice.cookie);

        const error = await evicted;
        assert.equal(error.code, "SESSION_REPLACED");
        assert.ok(
          error.message,
          "the payload needs the server's plain-text fallback for a client that does not know the code"
        );
        await closed;

        // Long past the grace the eviction must not have armed.
        await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3));
        assert.deepEqual(
          announced,
          [],
          "the account never left the table, so nothing about it may be announced"
        );

        const secondClient: Client = { socket: second, user: alice.user };
        const rejoined = waitFor<SanitizedState>(second, "game:state");
        second.emit("game:rejoin", { roomCode: room.roomId });
        const state = await rejoined;
        assert.equal(state.players.length, 2, "the same table, with both seats still human");
        assertHandSecrecy(state, "the surviving socket");

        // Plays the hand out from the new socket: broadcasts reach it, its
        // moves are accepted, and the seat is still its own.
        const result = await driveHandToExchangeOrOver([secondClient, bob], () => {
          for (const client of [secondClient, bob]) {
            client.socket.emit("game:rejoin", { roomCode: room.roomId });
          }
        });
        assert.ok(
          result.stoppedOn === "exchange" || result.stoppedOn === "gameOver",
          "the replacement socket has to be able to play the hand out"
        );
        assert.deepEqual(announced, [], "and still nothing was announced about the seat");
      } finally {
        // Empty the table before its sockets go: a socket that simply closes on
        // a live game arms a grace timer that would then fire against a stopped
        // server.
        for (const socket of [second, bob.socket]) {
          if (socket?.connected) socket.emit("room:leave");
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        for (const socket of [alice.socket, bob.socket, second]) socket?.close();
      }
    });
  }
);
