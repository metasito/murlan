// tests/integration/friendRowTravelsWithTheEvent.test.ts — the announcement
// carries the row the fetch would have returned.
//
// The client can only seat a pushed row if the push is the same row the GET
// serves. This is the half that says so, against a real database, and it also
// measures the gap the push closes: the emit lands on one frame, and the fetch
// an invalidation starts lands a round trip later. `tests/native/
// friendRowArrivesWithTheBanner.test.tsx` is the client half.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";
import type { FriendInfo, FriendRequestInfo } from "../../lib/wire.ts";

interface Incoming {
  from: string;
  request?: FriendRequestInfo;
}

interface Accepted {
  by: string;
  friend?: FriendInfo;
}

async function get<T>(server: TestServer, path: string, cookie: string): Promise<T> {
  const res = await fetch(`${server.url}${path}`, { headers: { cookie } });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return JSON.parse(text) as T;
}

describe("a friend event carries the row the cache needs", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  test("the pushed request is the row GET /api/friends/requests serves", async () => {
    const sender = await connectAs(server, "row_sender");
    const recipient = await connectAs(server, "row_recipient");

    const incoming = waitFor<Incoming>(recipient.socket, "friend:request_incoming");
    const add = await fetch(`${server.url}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sender.cookie },
      body: JSON.stringify({ username: recipient.user.username }),
    });
    assert.equal(add.status, 200, await add.text());

    const emitAt = Date.now();
    const event = await incoming;
    const pushedAt = Date.now();

    assert.ok(
      event.request,
      "the announcement carried no row, so every surface but the banner has to " +
        "wait out a round trip before it can change"
    );

    // The gap the push closes, measured from the same moment on both paths.
    const fetched = await get<FriendRequestInfo[]>(
      server,
      "/api/friends/requests",
      recipient.cookie
    );
    const fetchedAt = Date.now();
    console.log(
      `#827 emit→row: push ${pushedAt - emitAt}ms, fetch ${fetchedAt - emitAt}ms`
    );

    // Identical, not merely similar: a list holding one of each would flicker
    // between two versions of one request.
    assert.deepEqual(
      event.request,
      fetched[0],
      "the pushed row and the fetched row are different shapes"
    );
    assert.equal(event.request.username, sender.user.username);
    assert.equal(typeof event.request.id, "string");
    assert.ok(event.request.createdAt, "the pushed row carried no createdAt");

    sender.socket.close();
    recipient.socket.close();
  });

  test("an acceptance carries the new friend the same way", async () => {
    const sender = await connectAs(server, "acc_sender");
    const recipient = await connectAs(server, "acc_recipient");

    const add = await fetch(`${server.url}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sender.cookie },
      body: JSON.stringify({ username: recipient.user.username }),
    });
    assert.equal(add.status, 200, await add.text());

    const pending = await get<FriendRequestInfo[]>(
      server,
      "/api/friends/requests",
      recipient.cookie
    );
    assert.equal(pending.length, 1);

    const accepted = waitFor<Accepted>(sender.socket, "friend:request_accepted");
    const res = await fetch(`${server.url}/api/friends/accept/${pending[0].id}`, {
      method: "POST",
      headers: { cookie: recipient.cookie },
    });
    assert.equal(res.status, 200, await res.text());

    const event = await accepted;
    assert.ok(
      event.friend,
      "the acceptance carried no row — the friends list is left waiting on a fetch"
    );

    const friends = await get<FriendInfo[]>(server, "/api/friends", sender.cookie);
    assert.deepEqual(
      event.friend,
      friends.find((f) => f.id === event.friend!.id),
      "the pushed friend and the fetched friend are different shapes"
    );
    assert.equal(event.friend.username, recipient.user.username);

    sender.socket.close();
    recipient.socket.close();
  });
});
