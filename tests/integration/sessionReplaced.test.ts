import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor, DEADLINE_SCALE } from "../helpers/client.ts";
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
 * What this is really about is the *table*. Replacing a socket is not the
 * player dropping, so it announces nothing and hands nothing to a bot; the seat
 * simply moves onto the new socket, which is then the one that answers for it.
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
            5_000 * DEADLINE_SCALE
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
        second.emit("game:rejoin", { roomId: room.roomId });
        const state = await rejoined;
        assert.equal(state.players.length, 2, "the same table, with both seats still human");
        assertHandSecrecy(state, "the surviving socket");

        // Plays the hand out from the new socket: broadcasts reach it, its
        // moves are accepted, and the seat is still its own.
        const result = await driveHandToExchangeOrOver([secondClient, bob], () => {
          for (const client of [secondClient, bob]) {
            client.socket.emit("game:rejoin", { roomId: room.roomId });
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

    /**
     * The replacement is the only socket the seat has left, so it has to be the
     * one that releases it. Nothing else can: the replaced socket's disconnect
     * declines to announce anything, and a replacement on a device that never
     * held the room code emits no `game:rejoin` — the path the case above takes,
     * and the one that hides this.
     *
     * Three seats, so the release is the bot takeover the surviving players keep
     * playing against rather than the two-seat teardown.
     */
    test("the seat is released when a replacement that never rejoined closes", async () => {
      const alice = await connectAs(server, "sess_repl_arta");
      const bob = await connectAs(server, "sess_repl_besnik");
      const carol = await connectAs(server, "sess_repl_cela");
      let second: Socket | null = null;
      try {
        await setUpRoom([alice, bob, carol], 3);
        await startGame([alice, bob, carol]);

        const dropped = waitFor<{ userId: string }>(
          bob.socket,
          "game:player_disconnected"
        );
        const takenOver = waitFor<{ userId: string; seatIndex: number }>(
          bob.socket,
          "game:seat_bot_takeover",
          GRACE_MS * 10
        );

        const closed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("the replaced socket was never closed")),
            5_000 * DEADLINE_SCALE
          );
          alice.socket.once("disconnect", () => {
            clearTimeout(timer);
            resolve();
          });
        });

        second = await openSecondSocket(alice.cookie);
        await closed;

        // The replacement's own connection has to be fully established before it
        // is closed again: a close in the same tick as the CONNECT packet never
        // reaches the server, and the socket is left open. `friend:online_list`
        // is the last thing the connection handler emits, so it is the readiness
        // signal — and a real client is never that fast anyway.
        await waitFor(second, "friend:online_list");
        const replacementId = second.id;
        second.close();

        // The disconnect handler returns without announcing down three paths,
        // and from here they are indistinguishable. Each logs, so the answer is
        // already in the output — but a suite run carries a hundred of those
        // lines, and only the ones naming this socket are about this failure.
        const drop = await dropped.catch((err: Error) => {
          throw new Error(
            `${err.message}
` +
              `  userId ${alice.user.id}, replacement socket ${replacementId}
` +
              `  grep that socket id for "Socket held no room", "Account still holds ` +
              `another socket" or "Seat released without a grace period": whichever ` +
              `carries it is the diagnosis.`
          );
        });
        assert.equal(
          drop.userId,
          alice.user.id,
          "closing the account's only remaining socket has to announce the drop"
        );
        const takeover = await takenOver;
        assert.equal(
          takeover.userId,
          alice.user.id,
          "and the grace has to expire into a bot taking the seat over"
        );
      } finally {
        for (const socket of [bob.socket, carol.socket]) {
          if (socket.connected) socket.emit("room:leave");
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        for (const socket of [alice.socket, bob.socket, carol.socket, second])
          socket?.close();
      }
    });
  }
);
