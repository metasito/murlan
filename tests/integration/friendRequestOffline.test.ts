// tests/integration/friendRequestOffline.test.ts — the request survives the
// recipient being away.
//
// `emitToUser` drops its event when the recipient has no socket, so the push
// is an optimisation and the row is the truth. This is the server half of that
// claim: a request created while the recipient was not connected is served to
// them the moment they ask. `tests/native/friendRequestReconcile.test.tsx` is
// the other half — that the client asks at all, on connect, which is what was
// actually missing.
//
// Only a real database can carry this: the whole property is a row outliving
// the connection that would have announced it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("a friend request outlives the recipient being offline", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  test("the recipient is served a request made while they had no socket", async () => {
    const sender = await register(server, "offline_sender");
    const recipient = await register(server, "offline_recipient");

    // Neither has ever opened a socket, so `emitToUser` has nobody to tell.
    const add = await fetch(`${server.url}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sender.cookie },
      body: JSON.stringify({ username: recipient.user.username }),
    });
    assert.equal(add.status, 200, await add.text());

    const pending = await fetch(`${server.url}/api/friends/requests`, {
      headers: { cookie: recipient.cookie },
    });
    const rows = (await pending.json()) as { id: string; username: string }[];
    assert.equal(
      rows.length,
      1,
      "the recipient was served no pending request, so a request sent while they " +
        "were away is reachable by nothing at all"
    );
    assert.equal(rows[0]?.username, sender.user.username);

    // And the sender can see their own, which is what makes cancelling an exit
    // rather than a guess.
    const sent = await fetch(`${server.url}/api/friends/sent`, {
      headers: { cookie: sender.cookie },
    });
    const sentRows = (await sent.json()) as { username: string }[];
    assert.equal(sentRows.length, 1);
    assert.equal(sentRows[0]?.username, recipient.user.username);
  });

  // Told "already sent" for a request that is in fact waiting on them, a player
  // has no way to learn that accepting it is the move. The two directions are
  // different situations and need different answers.
  test("sending back into a pending request says to accept it, not that it was already sent", async () => {
    const first = await register(server, "swap_first");
    const second = await register(server, "swap_second");

    const add = await fetch(`${server.url}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: first.cookie },
      body: JSON.stringify({ username: second.user.username }),
    });
    assert.equal(add.status, 200, await add.text());

    const back = await fetch(`${server.url}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: second.cookie },
      body: JSON.stringify({ username: first.user.username }),
    });
    assert.equal(back.status, 409);
    const body = (await back.json()) as { code?: string };
    assert.equal(
      body.code,
      "FRIEND_REQUEST_INCOMING_PENDING",
      "the recipient of a pending request was told they had already sent one"
    );
  });

  test("sending the same request twice still reads as already sent", async () => {
    const a = await register(server, "dup_sender");
    const b = await register(server, "dup_recipient");

    for (const expected of [200, 409]) {
      const res = await fetch(`${server.url}/api/friends/add`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: a.cookie },
        body: JSON.stringify({ username: b.user.username }),
      });
      assert.equal(res.status, expected);
      if (expected === 409) {
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, "FRIEND_REQUEST_ALREADY_SENT");
      }
    }
  });
});
