import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { connectAs, leaveRooms, nothingArrives, reconnectWith, type TestSocket, waitFor } from "../helpers/client.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { activeGames, socketRoomMap, userSocketMap } from "../../server/game/gameRoom.ts";
import { disconnectGraceMs } from "../../server/game/gameTimers.ts";
import {
  setUpRoom,
  startGame,
  assertHandSecrecy,
  type Client,
} from "../helpers/table.ts";
import { driveRound } from "../helpers/gameDriver.ts";
import type { WireRoomState } from "../../shared/protocol.ts";

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
 * The grace is deliberately short: if the eviction ever did arm it, the bot
 * takeover lands inside the window this test watches.
 */
process.env.MURLAN_AFK_TIMEOUT_MS = "5000";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";

/**
 * Asked of the server rather than restated, so a grace this file cannot
 * actually shorten shows up as its own deadlines moving with it instead of as
 * a timeout with nothing to point at.
 */
const GRACE_MS = disconnectGraceMs();

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

    test("evicts the first with SESSION_REPLACED and leaves the seat alone", async () => {
      const alice = await connectAs(server, "sess_repl_alma");
      const bob = await connectAs(server, "sess_repl_bekim");
      let second: TestSocket | null = null;
      try {
        const room: WireRoomState = await setUpRoom([alice, bob], 2);
        await startGame([alice, bob]);

        // The two things the table must never be told. Collected for the whole
        // test rather than asserted once: a takeover that arrives late is the
        // same bug as one that arrives early.
        const announced: string[] = [];
        for (const event of ["game:player_disconnected", "game:seat_bot_takeover"] as const) {
          bob.socket.on(event, () => announced.push(event));
        }

        const evicted = waitFor(alice.socket, "socket:error");
        const closed = waitFor(alice.socket, "disconnect");

        // Server time from here to past the grace: a grace the eviction armed fires on the advance.
        const clock = fakeClock(Date.now());
        const restore = installClock(clock);
        try {
          second = await reconnectWith(server, alice.cookie);

          const error = await evicted;
          assert.equal(error.code, "SESSION_REPLACED");
          assert.ok(
            error.message,
            "the payload needs the server's plain-text fallback for a client that does not know the code"
          );
          await closed;

          const quiet = [
            nothingArrives(bob.socket, "game:player_disconnected"),
            nothingArrives(bob.socket, "game:seat_bot_takeover"),
          ];
          clock.advance(GRACE_MS * 3);
          await Promise.all(quiet);
        } finally {
          restore();
        }
        assert.deepEqual(
          announced,
          [],
          "the account never left the table, so nothing about it may be announced"
        );

        const secondClient: Client = { socket: second, user: alice.user, cookie: alice.cookie };
        const rejoined = waitFor(second, "game:state");
        second.emit("game:rejoin", { roomId: room.roomId });
        const state = await rejoined;
        assert.equal(state.players.length, 2, "the same table, with both seats still human");
        assertHandSecrecy(state, "the surviving socket");

        // Plays the round out from the new socket: broadcasts reach it, its
        // moves are accepted, and the seat is still its own.
        const result = await driveRound([secondClient, bob], () => {
          for (const client of [secondClient, bob]) {
            client.socket.emit("game:rejoin", { roomId: room.roomId });
          }
        });
        assert.ok(
          result.stoppedOn === "exchange" || result.stoppedOn === "roundOver",
          "the replacement socket has to be able to play the round out"
        );
        assert.deepEqual(announced, [], "and still nothing was announced about the seat");
      } finally {
        // Empty the table before its sockets go: a socket that simply closes on
        // a live game arms a grace timer that would then fire against a stopped
        // server.
        await leaveRooms([second, bob.socket]);
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
      let second: TestSocket | null = null;
      try {
        await setUpRoom([alice, bob, carol], 3);
        await startGame([alice, bob, carol]);

        const dropped = waitFor(
          bob.socket,
          "game:player_disconnected"
        );
        // The takeover is one grace after the close, plus whatever the round
        // trip costs — so the deadline is that, not a multiple picked to look
        // generous. `waitFor` applies DEADLINE_SCALE itself.
        const takenOver = waitFor(
          bob.socket,
          "game:seat_bot_takeover",
          GRACE_MS + 2_000
        );
        // Both deadlines are already running, so when the first assertion fails
        // this one rejects a moment later with nothing awaiting it. node:test
        // cancels the test on that unhandled rejection and reports it in place
        // of the failure that actually happened.
        takenOver.catch(() => {});

        const closed = waitFor(alice.socket, "disconnect");

        second = await reconnectWith(server, alice.cookie);
        await closed;

        // The replacement's own connection has to be fully established before it
        // is closed again: a close in the same tick as the CONNECT packet never
        // reaches the server, and the socket is left open. `friend:online_list`
        // is the last thing the connection handler emits, so it is the readiness
        // signal — and a real client is never that fast anyway.
        await waitFor(second, "friend:online_list");
        // Present once connected; the wait above is that guarantee.
        const replacementId = second.id!;
        // Every exit of the disconnect handler is downstream of the server
        // observing the close, and from the client the two are the same
        // silence. The server runs in this process, so its own socket answers
        // which half failed.
        let serverSawClose = false;
        server.io.sockets.sockets
          .get(replacementId)
          ?.once("disconnect", () => {
            serverSawClose = true;
          });
        second.close();

        // The disconnect handler returns without announcing down three paths,
        // and from here they are indistinguishable. Each logs, so the answer is
        // already in the output — but a suite run carries a hundred of those
        // lines, and only the ones naming this socket are about this failure.
        const drop = await dropped.catch((err: Error) => {
          if (!serverSawClose) {
            throw new Error(
              `${err.message}
` +
                `  the server never observed socket ${replacementId} close, so its
` +
                `  disconnect handler never ran and none of the exits below is the
` +
                `  cause — the close itself was not delivered`
            );
          }
          // The three states the handler returned on are readable rather than
          // inferable. Exactly one of these lines explains the silence.
          const held = socketRoomMap.get(replacementId);
          throw new Error(
            `${err.message}
` +
              `  userId ${alice.user.id}, replacement socket ${replacementId}
` +
              `  socketRoomMap holds ${held ?? "nothing"} for it` +
              `${held ? "" : " -> the handler took the 'Socket held no room' exit"}
` +
              `  userSocketMap holds ${userSocketMap.get(alice.user.id) ?? "nothing"} for the account` +
              `${userSocketMap.has(alice.user.id) ? " -> the 'Account still holds another socket' exit" : ""}
` +
              `  activeGames ${held && activeGames.has(held) ? `has a game for ${held}` : "has no game for that room"}` +
              `${held && !activeGames.has(held) ? " -> the 'Seat released without a grace period' exit" : ""}` +
              `${held && activeGames.get(held)?.gameState.roundOver ? " (the game is over)" : ""}`
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
        await leaveRooms([bob.socket, carol.socket]);
        for (const socket of [alice.socket, bob.socket, carol.socket, second])
          socket?.close();
      }
    });
  }
);
