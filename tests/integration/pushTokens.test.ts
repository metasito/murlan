// tests/integration/pushTokens.test.ts — the device registry, and the invite
// that would otherwise be dropped.
//
// tests/pushShape.test.ts covers what is sent to Expo. What it cannot reach is
// the part that only exists against a real database: that re-registering a
// device overwrites rather than accumulates, that deleting an account takes
// its devices with it, and that an invite to a friend who is not connected
// now goes somewhere instead of returning early.
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
import { translate } from "../../shared/i18n.ts";
import { createServer, type Server } from "node:http";

/**
 * Stands in for Expo's push service.
 *
 * Set before the app is imported: server/push.ts reads the override at module
 * load. Without it this suite would post invented tokens to Expo's production
 * endpoint on every run.
 */
const received: unknown[][] = [];
let expoStub: Server;

async function startExpoStub(): Promise<void> {
  expoStub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ status: "ok" }] }));
    });
  });
  await new Promise<void>((resolve) => expoStub.listen(0, "127.0.0.1", resolve));
  const port = (expoStub.address() as { port: number }).port;
  process.env.MURLAN_EXPO_PUSH_URL = `http://127.0.0.1:${port}/send`;
}

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

describe("push token registry", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let maxDevices: number;

  before(async () => {
    await startExpoStub();
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Imported here, not at the top: server/push.ts pulls in server/db.ts,
    // which builds its pool the moment it loads. Loading it before
    // startTestServer has pointed connections at its throwaway schema binds
    // the app to the default one, and every test then shares state.
    ({ MAX_DEVICES_PER_USER: maxDevices } = await import("../../server/push.ts"));
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
    await new Promise<void>((resolve) => expoStub.close(() => resolve()));
  });

  /** Waits for the stub to see a request, so the fire-and-forget send lands. */
  async function waitForPush(timeoutMs = 3_000): Promise<unknown[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (received.length > 0) return received.shift()!;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("no push was sent");
  }

  const post = (cookie: string, body: unknown, method = "POST") =>
    fetch(`${server.url}/api/push/token`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const rowsFor = async (userId: string) =>
    (await dbPool.query("SELECT token, platform FROM push_tokens WHERE user_id = $1", [userId]))
      .rows;

  test("a device registers, and registering again does not duplicate it", async () => {
    const ana = await connectAs(server, "push_ana");
    try {
      assert.equal((await post(ana.cookie, { token: TOKEN_A, platform: "ios" })).status, 200);
      assert.equal((await rowsFor(ana.user.id)).length, 1);

      // The same phone opening the Friends screen again. The token is keyed on
      // itself precisely so this is one upsert and not a second row.
      assert.equal((await post(ana.cookie, { token: TOKEN_A, platform: "ios" })).status, 200);
      const rows = await rowsFor(ana.user.id);
      assert.equal(rows.length, 1, "re-registering the same device must overwrite");

      // A second device is a second row: an invite should reach both.
      await post(ana.cookie, { token: TOKEN_B, platform: "android" });
      assert.equal((await rowsFor(ana.user.id)).length, 2);
      assert.deepEqual(
        (await rowsFor(ana.user.id)).map((r) => r.platform).sort(),
        ["android", "ios"]
      );
    } finally {
      ana.socket.close();
    }
  });

  test("logging out withdraws only this device", async () => {
    const ana = await connectAs(server, "push_out");
    try {
      await post(ana.cookie, { token: TOKEN_A, platform: "ios" });
      await post(ana.cookie, { token: TOKEN_B, platform: "android" });

      const res = await post(ana.cookie, { token: TOKEN_A, platform: "ios" }, "DELETE");
      assert.equal(res.status, 200);

      const rows = await rowsFor(ana.user.id);
      assert.deepEqual(rows.map((r) => r.token), [TOKEN_B], "the other phone keeps its rows");
    } finally {
      ana.socket.close();
    }
  });

  // A token is keyed on itself, so the value alone cannot be what authorises
  // the delete: anyone who learns it would be able to unregister that phone.
  test("a token the caller does not own survives the delete", async () => {
    const ana = await connectAs(server, "push_idor_a");
    const ben = await connectAs(server, "push_idor_b");
    try {
      await post(ben.cookie, { token: TOKEN_A, platform: "ios" });

      const res = await post(ana.cookie, { token: TOKEN_A, platform: "ios" }, "DELETE");
      assert.equal(res.status, 200);
      assert.deepEqual(
        (await rowsFor(ben.user.id)).map((r) => r.token),
        [TOKEN_A],
        "Ana unregistered Ben's phone"
      );

      // The floor: a delete that reaches nothing would pass the line above even
      // if the route stopped deleting entirely.
      await post(ben.cookie, { token: TOKEN_A, platform: "ios" }, "DELETE");
      assert.equal((await rowsFor(ben.user.id)).length, 0);
    } finally {
      ana.socket.close();
      ben.socket.close();
    }
  });

  // A token is accepted on an authenticated request and keyed on itself, so
  // without a cap an account could register unlimited well-formed tokens: rows
  // that never expire, and that every later invite would fan out to in one
  // request to Expo. The rate limiter slows that down; only the cap stops it.
  test("an account cannot be reachable on unlimited devices", async () => {
    const ana = await connectAs(server, "push_cap");
    try {
      const tokens = Array.from(
        { length: maxDevices + 3 },
        (_, i) => `ExponentPushToken[cap${String(i).padStart(18, "0")}]`
      );
      for (const token of tokens) {
        assert.equal((await post(ana.cookie, { token, platform: "ios" })).status, 200);
      }

      const rows = await rowsFor(ana.user.id);
      assert.equal(rows.length, maxDevices, "the oldest devices are forgotten");

      // The ones kept are the most recent, so the phone in the player's hand
      // is never the one dropped.
      const kept = (
        await dbPool.query("SELECT token FROM push_tokens WHERE user_id = $1", [ana.user.id])
      ).rows.map((r) => r.token as string);
      assert.deepEqual(kept.sort(), tokens.slice(-maxDevices).sort());
    } finally {
      ana.socket.close();
    }
  });

  test("a malformed token is refused rather than stored", async () => {
    const ana = await connectAs(server, "push_bad");
    try {
      for (const token of ["", "not-a-token", "ExponentPushToken", `x`.repeat(300)]) {
        const res = await post(ana.cookie, { token, platform: "ios" });
        assert.ok(res.status >= 400, `${JSON.stringify(token.slice(0, 20))} was accepted`);
      }
      assert.equal((await rowsFor(ana.user.id)).length, 0);
    } finally {
      ana.socket.close();
    }
  });

  test("an unauthenticated caller cannot register a token", async () => {
    const res = await fetch(`${server.url}/api/push/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN_A, platform: "ios" }),
    });
    assert.equal(res.status, 401);
  });

  // Every other table naming a user cascades on delete and this one must too:
  // a token is a handle on someone's phone, and it has no business outliving
  // the account that registered it.
  test("deleting an account takes its devices with it", async () => {
    const ana = await connectAs(server, "push_del");
    await post(ana.cookie, { token: TOKEN_A, platform: "ios" });
    assert.equal((await rowsFor(ana.user.id)).length, 1);

    const res = await fetch(`${server.url}/api/users/me`, {
      method: "DELETE",
      headers: { cookie: ana.cookie },
    });
    assert.equal(res.status, 200, await res.text());
    ana.socket.close();

    assert.equal((await rowsFor(ana.user.id)).length, 0);
  });

  // The reason the feature exists. Before this, friend:invite returned early
  // when the friend held no socket and the invite was simply lost.
  test("an invite to a connected friend still arrives over the socket", async () => {
    const ana = await connectAs(server, "push_inv_a");
    const ben = await connectAs(server, "push_inv_b");
    try {
      await fetch(`${server.url}/api/friends/add`, {
        method: "POST",
        headers: { cookie: ana.cookie, "content-type": "application/json" },
        body: JSON.stringify({ username: ben.user.username }),
      });
      const requests = (await (
        await fetch(`${server.url}/api/friends/requests`, { headers: { cookie: ben.cookie } })
      ).json()) as { id: string }[];
      assert.equal(requests.length, 1, "the friend request was not created");
      const accepted = await fetch(`${server.url}/api/friends/accept/${requests[0].id}`, {
        method: "POST",
        headers: { cookie: ben.cookie },
      });
      assert.equal(accepted.status, 200, await accepted.text());

      const invited = waitFor<{ from: string; roomCode: string }>(ben.socket, "friend:invite");
      ana.socket.emit("friend:invite", { friendUserId: ben.user.id, roomCode: "ZZZ999" });
      const payload = await invited;

      assert.equal(payload.roomCode, "ZZZ999");
      assert.equal(payload.from, ana.user.username);
      assert.equal(received.length, 0, "a connected friend saw it on screen; a push would be noise");
    } finally {
      ana.socket.close();
      ben.socket.close();
    }
  });

  // The whole point of the feature. This path used to be `return`.
  test("an invite to a friend who is not connected becomes a notification", async () => {
    const ana = await connectAs(server, "push_off_a");
    const ben = await connectAs(server, "push_off_b");
    try {
      await fetch(`${server.url}/api/friends/add`, {
        method: "POST",
        headers: { cookie: ana.cookie, "content-type": "application/json" },
        body: JSON.stringify({ username: ben.user.username }),
      });
      const requests = (await (
        await fetch(`${server.url}/api/friends/requests`, { headers: { cookie: ben.cookie } })
      ).json()) as { id: string }[];
      await fetch(`${server.url}/api/friends/accept/${requests[0].id}`, {
        method: "POST",
        headers: { cookie: ben.cookie },
      });

      await post(ben.cookie, { token: TOKEN_A, platform: "ios" });
      await post(ben.cookie, { token: TOKEN_B, platform: "android" });

      // Ben puts the phone down. His socket is what used to make the invite
      // reachable, and its absence is what used to make it vanish.
      ben.socket.close();
      await new Promise((r) => setTimeout(r, 300));

      ana.socket.emit("friend:invite", { friendUserId: ben.user.id, roomCode: "ZZZ999" });
      const sent = (await waitForPush()) as {
        to: string;
        title: string;
        body: string;
        data?: { roomCode?: string };
      }[];

      assert.equal(sent.length, 2, "both of his devices are told");
      assert.deepEqual(sent.map((m) => m.to).sort(), [TOKEN_A, TOKEN_B].sort());
      for (const message of sent) {
        assert.match(message.body, new RegExp(ana.user.username));
        // Tapping it has to be able to reach the table that is waiting.
        assert.equal(message.data?.roomCode, "ZZZ999");
      }
    } finally {
      ana.socket.close();
      ben.socket.close();
    }
  });

  // Nothing on the client can fix this after the fact: the OS draws the
  // notification from what the server sent.
  test("each device is written in the language that device registered", async () => {
    const ana = await connectAs(server, "push_loc_a");
    const ben = await connectAs(server, "push_loc_b");
    try {
      await fetch(`${server.url}/api/friends/add`, {
        method: "POST",
        headers: { cookie: ana.cookie, "content-type": "application/json" },
        body: JSON.stringify({ username: ben.user.username }),
      });
      const requests = (await (
        await fetch(`${server.url}/api/friends/requests`, { headers: { cookie: ben.cookie } })
      ).json()) as { id: string }[];
      await fetch(`${server.url}/api/friends/accept/${requests[0].id}`, {
        method: "POST",
        headers: { cookie: ben.cookie },
      });

      await post(ben.cookie, { token: TOKEN_A, platform: "ios", locale: "it" });
      await post(ben.cookie, { token: TOKEN_B, platform: "android", locale: "sq" });

      ben.socket.close();
      await new Promise((r) => setTimeout(r, 300));

      ana.socket.emit("friend:invite", { friendUserId: ben.user.id, roomCode: "LOC001" });
      const sent = (await waitForPush()) as { to: string; body: string }[];

      const bodyOf = (token: string) => sent.find((m) => m.to === token)?.body;
      assert.equal(
        bodyOf(TOKEN_A),
        translate("it", "server.FRIEND_INVITE", { username: ana.user.username })
      );
      assert.equal(
        bodyOf(TOKEN_B),
        translate("sq", "server.FRIEND_INVITE", { username: ana.user.username })
      );
      // The floor: two identical bodies would satisfy nothing above if the
      // catalogues ever converged, and would mean the locale was never read.
      assert.notEqual(bodyOf(TOKEN_A), bodyOf(TOKEN_B));
    } finally {
      ana.socket.close();
      ben.socket.close();
    }
  });

  test("a stranger cannot make the server send a notification", async () => {
    const ana = await connectAs(server, "push_str_a");
    const ben = await connectAs(server, "push_str_b");
    try {
      await post(ben.cookie, { token: TOKEN_A, platform: "ios" });
      ben.socket.close();
      await new Promise((r) => setTimeout(r, 300));

      // No friendship was ever accepted between these two.
      ana.socket.emit("friend:invite", { friendUserId: ben.user.id, roomCode: "ZZZ999" });
      await new Promise((r) => setTimeout(r, 800));

      assert.equal(received.length, 0, "the friendship check must gate the push too");
    } finally {
      ana.socket.close();
      ben.socket.close();
    }
  });
});
