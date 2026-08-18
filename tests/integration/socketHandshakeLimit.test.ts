import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

/**
 * SEC-05: the socket.io handshake is the one entry point no Express limiter
 * covers — socket.io answers `/socket.io/*` on the shared http.Server before
 * the Express stack runs — and every accepted connection costs database
 * round-trips before the client has emitted anything.
 *
 * Its own file because the budget is 60 connections a minute and this suite
 * spends all of it; `/api/auth/register` is limited per process, so the two
 * accounts here need an allowance no other suite has already drawn on.
 */

describe(
  "socket handshake rate limit",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;

    before(async () => {
      server = await startTestServer();
    });

    after(async () => {
      // The disconnect path debounces its friend-status emit by 400ms; let the
      // last of them finish before the pool goes.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await server.stop();
    });

    /**
     * Handshakes on the account's session cookie rather than a ticket: the
     * ticket route mints at most 60 a minute per address, so the attempt that
     * has to reach the socket limiter would be refused by the REST one first.
     * Resolves either way — the refusal is what half of this suite asserts on.
     */
    function connectWithCookie(
      cookie: string
    ): Promise<{ ok: boolean; err?: string; socket?: Socket }> {
      return new Promise((resolve) => {
        const socket = ioClient(server.url, {
          transports: ["websocket"],
          extraHeaders: { cookie },
          reconnection: false,
        });
        socket.on("connect", () => resolve({ ok: true, socket }));
        socket.on("connect_error", (err) => {
          socket.close();
          resolve({ ok: false, err: err.message });
        });
      });
    }

    test("the 61st handshake by one account in a minute is refused while another account still connects", async () => {
      const flooder = await register(server, "handshake_flooder");
      const bystander = await register(server, "handshake_bystander");

      for (let attempt = 1; attempt <= 60; attempt++) {
        const accepted = await connectWithCookie(flooder.cookie);
        assert.ok(
          accepted.ok,
          `handshake ${attempt} is inside the account's budget but was refused: ${accepted.err}`
        );
        accepted.socket!.close();
      }

      const refused = await connectWithCookie(flooder.cookie);
      assert.equal(
        refused.ok,
        false,
        "the 61st handshake inside the window must be refused"
      );
      assert.match(refused.err ?? "", /Too many connections/);

      // Per account, not per server: one account exhausting its budget must
      // not keep anyone else off the game.
      const other = await connectWithCookie(bystander.cookie);
      assert.ok(
        other.ok,
        `a different account must not share the flooder's budget: ${other.err}`
      );
      other.socket!.close();
    });

    /**
     * The other half of the limit's contract, and the half a refusal breaks
     * loudly: the budget is there to stop a flood, not to lock a phone out of
     * its own game. A connection that keeps dropping — a tunnel, a lift, a
     * handover between cells — mints one ticket and one handshake per attempt,
     * and socket.io retries by itself, so the client spends the budget without
     * the player doing anything at all.
     */
    test("a client that keeps dropping and reconnecting is never refused", async () => {
      const commuter = await register(server, "handshake_commuter");

      // A bad ten minutes on a train, not a number chosen to sit under the
      // ceiling: the limit has to have room above whatever a real connection
      // does to itself.
      for (let attempt = 1; attempt <= 12; attempt++) {
        const back = await connectWithCookie(commuter.cookie);
        assert.ok(
          back.ok,
          `reconnect ${attempt} of an ordinary flapping connection was refused: ${back.err}`
        );
        back.socket!.close();
      }
    });

    /**
     * The friends read is the most expensive part of accepting a connection —
     * an innerJoin against `users` — and the connect notice and the online list
     * need the very same rows.
     */
    test("a connection reads the caller's friends once", async () => {
      const { storage } = await import("../../server/storage.ts");
      const { connectAs, waitFor } = await import("../helpers/client.ts");
      const realGetFriends = storage.getFriends;
      let calls = 0;
      storage.getFriends = async function (userId: string) {
        calls += 1;
        return realGetFriends.call(this, userId);
      };
      try {
        const client = await connectAs(server, "handshake_counted");
        try {
          await waitFor(client.socket, "friend:online_list", 5_000);
          // The second read was fire-and-forget, so it could still be in
          // flight when the list arrives.
          await new Promise((resolve) => setTimeout(resolve, 250));
          assert.equal(calls, 1, "one connection must cost one getFriends");
        } finally {
          client.socket.close();
        }
      } finally {
        storage.getFriends = realGetFriends;
      }
    });
  }
);
