// tests/integration/crossInstance.test.ts — two servers, one database.
//
// Every other integration suite boots one app in this process, which is the one
// shape that cannot see this class of defect: `io.to(...)` reaches the sockets
// the calling process holds, so with a single instance it is always right.
// Production deploys with no instance cap, and there the same call reached half
// the room.
//
// So this spawns two real servers against one schema and asserts across them.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import { PROTOCOL_AUTH } from "../helpers/client.ts";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";
import { boot, type Instance } from "../helpers/instance.ts";
import { driveHumansToGameOver } from "../helpers/gameDriver.ts";

const PORTS = [5561, 5562] as const;
/** Short, so the "was it re-sent?" window below is seconds rather than tens. */
const ACK_TIMEOUT_MS = 700;

async function register(port: number, username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "cross-instance-pw", email: `${username}@example.test` }),
  });
  const text = await res.text();
  assert.equal(res.status, 202, `register ${username}: ${text}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function connectSocket(port: number, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      auth: PROTOCOL_AUTH,
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

function waitFor<T>(socket: Socket, event: string, ms = 6_000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("broadcasts cross server instances", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  const schema = `xinst_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const scoped = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
  const instances: Instance[] = [];
  const sockets: Socket[] = [];
  let aCookie = "";
  let bCookie = "";
  let aSocket: Socket;
  let bSocket: Socket;
  let aName = "";
  let bName = "";

  before(async () => {
    const admin = new pg.Pool({ connectionString: baseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();

    // Sequentially: both run `ensureSchema` against the same empty schema, and
    // `CREATE TYPE` is not idempotent against a concurrent identical one.
    for (const port of PORTS) instances.push(await boot(port, scoped, {
      MURLAN_STATE_ACK_TIMEOUT_MS: String(ACK_TIMEOUT_MS),
      // Nothing here plays a hand; an AFK auto-move mid-assertion would be
      // state arriving for a reason that is not a re-send.
      MURLAN_AFK_TIMEOUT_MS: "600000",
    }));

    const tag = Date.now().toString(36);
    aName = `xa${tag}`;
    bName = `xb${tag}`;
    aCookie = await register(PORTS[0], aName);
    bCookie = await register(PORTS[1], bName);
    aSocket = await connectSocket(PORTS[0], aCookie);
    bSocket = await connectSocket(PORTS[1], bCookie);
    sockets.push(aSocket, bSocket);
  });

  after(async () => {
    for (const s of sockets) s.close();
    for (const i of instances) i.child.kill("SIGKILL");
    const admin = new pg.Pool({ connectionString: baseUrl });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  test("a room broadcast reaches the player on the other instance", async () => {
    const created = waitFor<{ code: string; roomId: string }>(aSocket, "room:state");
    aSocket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    assert.ok(room, "instance 1 never answered room:create");

    const aHears = waitFor<{ players: unknown[] }>(aSocket, "room:state");
    bSocket.emit("room:join", { code: room.code });

    const aState = await aHears;
    assert.ok(
      aState,
      "the host was never told the other instance's player joined — io.to(roomId) " +
        "did not leave the process that called it"
    );
    assert.equal(aState.players.length, 2);
  });

  test("presence sees an account connected to the other instance", async () => {
    const add = await fetch(`http://127.0.0.1:${PORTS[0]}/api/friends/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: aCookie },
      body: JSON.stringify({ username: bName }),
    });
    assert.equal(add.status, 200, await add.text());

    const listRes = await fetch(`http://127.0.0.1:${PORTS[1]}/api/friends/requests`, {
      headers: { cookie: bCookie },
    });
    const requests = JSON.parse(await listRes.text()) as { id: string }[];
    assert.equal(requests.length, 1, "the friend request did not reach the other instance's database view");

    // The accept happens on instance 2 and the person who must hear about it
    // is on instance 1 — `emitToUser` addresses the account, not a socket, so
    // this is delivered by the adapter or not at all.
    const accepted = waitFor<{ by: string }>(aSocket, "friend:request_accepted");
    const accept = await fetch(
      `http://127.0.0.1:${PORTS[1]}/api/friends/accept/${requests[0].id}`,
      { method: "POST", headers: { cookie: bCookie } }
    );
    assert.equal(accept.status, 200, await accept.text());
    const notice = await accepted;
    assert.ok(
      notice,
      "the requester was never told their friend request was accepted on the " +
        "other instance"
    );
    assert.equal(notice.by, bName);

    const list = waitFor<{ onlineIds: string[] }>(aSocket, "friend:online_list");
    aSocket.emit("friend:get_online_list");
    const payload = await list;
    assert.ok(payload, "no online list came back");
    assert.equal(
      payload.onlineIds.length,
      1,
      "a friend connected to the other instance read as offline — presence is " +
        "still answering from this process's own rooms"
    );
  });

  test("one account cannot hold a socket on each instance", async () => {
    // The singleton rule was enforced through `userSocketMap` and
    // `io.sockets.sockets`, both of which only know this process — so a second
    // connection elsewhere was simply not seen, and the account held two live
    // sockets. Its own game screen would then be driven by two servers.
    const extraCookie = await register(PORTS[0], `xc${Date.now().toString(36)}`);
    const first = await connectSocket(PORTS[0], extraCookie);
    sockets.push(first);

    const dropped = new Promise<string>((resolve) => {
      first.once("disconnect", (reason: string) => resolve(reason));
      setTimeout(() => resolve("still connected"), 6_000);
    });
    const told = waitFor<{ code: string }>(first, "socket:error");

    const second = await connectSocket(PORTS[1], extraCookie);
    sockets.push(second);

    assert.notEqual(
      await dropped,
      "still connected",
      "the socket on the other instance stayed live — one account now has two"
    );
    assert.equal(second.connected, true, "the arriving socket must be the one that survives");
    assert.equal((await told)?.code, "SESSION_REPLACED", "the replaced client must be told why");
  });

  async function post(port: number, path: string, cookie: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body ?? {}),
    });
  }

  async function login(port: number, username: string): Promise<string> {
    const res = await post(port, "/api/auth/login", "", { username, password: "cross-instance-pw" });
    assert.equal(res.status, 200, await res.text());
    return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }

  async function userIdOf(cookie: string): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${PORTS[0]}/api/auth/me`, { headers: { cookie } });
    return ((await res.json()) as { id: string }).id;
  }

  async function ticketFor(cookie: string): Promise<string> {
    const res = await post(PORTS[0], "/api/auth/socket-ticket", cookie);
    assert.equal(res.status, 200);
    return ((await res.json()) as { ticket: string }).ticket;
  }

  function connectTicket(port: number, ticket: string): Promise<Socket | null> {
    return new Promise((resolve) => {
      const s = ioClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        auth: { ...PROTOCOL_AUTH, ticket },
        reconnection: false,
      });
      s.once("connect", () => resolve(s));
      s.once("connect_error", () => {
        s.close();
        resolve(null);
      });
    });
  }

  function closed(socket: Socket, ms = 6_000): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      socket.once("disconnect", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Signed in over instance 1, socket on instance 2. */
  async function accountOnSecond(tag: string) {
    const name = `x${tag}${Date.now().toString(36)}`;
    const cookie = await register(PORTS[0], name);
    const socket = await connectSocket(PORTS[1], cookie);
    sockets.push(socket);
    return { name, cookie, socket, id: await userIdOf(cookie) };
  }

  test("a password reset on one instance cuts the socket on the other", async () => {
    const acct = await accountOnSecond("rs");
    process.env.DATABASE_URL = scoped;
    const { userStore } = await import("../../server/store/userStore.ts");
    const { mintAuthToken } = await import("../../server/http/authTokens.ts");
    await userStore.markEmailVerified(acct.id, `${acct.name}@example.test`);
    const token = await mintAuthToken(acct.id, "password_reset", 60_000);

    const cut = closed(acct.socket);
    const res = await post(PORTS[0], "/api/auth/reset-password", "", {
      token,
      newPassword: "cross-instance-pw-2",
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(await cut, true, "the socket on the other instance outlived the reset");
  });

  test("a password change on one instance cuts another session's socket on the other", async () => {
    const acct = await accountOnSecond("cp");
    const otherDevice = await login(PORTS[0], acct.name);
    const cut = closed(acct.socket);
    const res = await post(PORTS[0], "/api/auth/change-password", otherDevice, {
      currentPassword: "cross-instance-pw",
      newPassword: "cross-instance-pw-2",
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(await cut, true, "the socket on the other instance outlived the change");
  });

  test("a logout on one instance cuts that session's socket on the other", async () => {
    const acct = await accountOnSecond("lo");
    const cut = closed(acct.socket);
    assert.equal((await post(PORTS[0], "/api/auth/logout", acct.cookie)).status, 200);
    assert.equal(await cut, true, "the socket on the other instance outlived the logout");
  });

  test("a ticket is single-use across instances, and dies with its session", async () => {
    const cookie = await register(PORTS[0], `xtk${Date.now().toString(36)}`);
    const ticket = await ticketFor(cookie);
    const first = await connectTicket(PORTS[0], ticket);
    assert.ok(first, "a fresh ticket must connect");
    sockets.push(first);
    assert.equal(await connectTicket(PORTS[1], ticket), null, "the other instance accepted a spent ticket");

    const unspent = await ticketFor(cookie);
    assert.equal((await post(PORTS[0], "/api/auth/logout", cookie)).status, 200);
    assert.equal(await connectTicket(PORTS[1], unspent), null, "a ticket outlived its session");
  });

  test("deleting an account on one instance ends its seat and socket on the other", async () => {
    const host = await accountOnSecond("dh");
    const leaver = await accountOnSecond("dl");
    const created = waitFor<{ code: string }>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    assert.ok(room, "instance 2 never answered room:create");
    const joined = waitFor(host.socket, "room:state");
    leaver.socket.emit("room:join", { code: room.code });
    assert.ok(await joined, "the join never reached the host");
    const dealt = waitFor(leaver.socket, "game:state", 15_000);
    host.socket.emit("room:start");
    assert.ok(await dealt, "the game never started");

    const left = waitFor<{ userId: string }>(host.socket, "game:player_left");
    const cut = closed(leaver.socket);
    const res = await fetch(`http://127.0.0.1:${PORTS[0]}/api/users/me`, {
      method: "DELETE",
      headers: { cookie: leaver.cookie },
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(await cut, true, "the deleted account's socket on the other instance stayed live");
    assert.equal((await left)?.userId, leaver.id, "the deleted account's seat was never vacated");
  });

  test("an acknowledged game:state is not re-sent across instances", async () => {
    // #554 sends every game:state with `.timeout(...)` and re-sends once if the
    // acknowledgement does not come back. An adapter that cannot carry an ack
    // makes that fire on every broadcast to every recipient — the server
    // doubles its own traffic and heals nothing. The observable form is a
    // second copy arriving after the ack timeout.
    let received = 0;
    bSocket.on("game:state", () => {
      received += 1;
    });

    aSocket.emit("room:start");
    await sleep(1_500);
    const afterStart = received;
    assert.ok(afterStart > 0, "the game never started across the two instances");

    await sleep(ACK_TIMEOUT_MS * 4);
    assert.equal(
      received,
      afterStart,
      "game:state arrived again after the acknowledgement window — the ack did " +
        "not cross instances, so every broadcast is being re-sent"
    );
  });

  /** A fresh two-seat table, both seats human, hosted from instance 1. */
  async function openTable(): Promise<{ roomId: string; code: string }> {
    const created = waitFor<{ code: string; roomId: string }>(aSocket, "room:state");
    aSocket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    assert.ok(room, "instance 1 never answered room:create");

    const seated = waitFor<{ players: unknown[] }>(aSocket, "room:state");
    bSocket.emit("room:join", { code: room.code });
    assert.ok(await seated, "the join never reached the host");
    return room;
  }

  test("a player on the other instance can play the hand out", async () => {
    // `room:start` runs on instance 1, so the game lives in instance 1's
    // `activeGames`. Every move the other player makes arrives at instance 2,
    // which holds no copy of it — and answered `NO_LIVE_GAME`, so the table
    // was playable by exactly the half of it that happened to land on the
    // instance that dealt.
    await openTable();
    const over = await driveHumansToGameOver(
      [aSocket, bSocket],
      () => aSocket.emit("room:start"),
      45_000
    );
    assert.ok(over, "the hand never finished");
  });

  test("the table outlives the instance that owned it", async () => {
    const room = await openTable();
    const dealt = waitFor(bSocket, "game:state", 15_000);
    aSocket.emit("room:start");
    assert.ok(await dealt, "the game never started");

    // What survives the kill is the `active_games` row, and it is written
    // fire-and-forget after the deal. Killing before it lands would test
    // nothing but the race.
    const admin = new pg.Pool({ connectionString: scoped });
    try {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const { rowCount } = await admin.query(
          "SELECT 1 FROM active_games WHERE room_id = $1",
          [room.roomId]
        );
        if (rowCount) break;
        assert.ok(Date.now() < deadline, "the deal was never persisted");
        await sleep(200);
      }
    } finally {
      await admin.end();
    }

    // Last, and deliberately destructive: instance 1 holds the only copy of
    // this game, and a table that dies with one process is a table nobody can
    // finish. `game:pass` carries no payload, so a reply of NO_LIVE_GAME can
    // only mean the handler ran and found no table.
    instances[0].child.kill("SIGKILL");
    await sleep(2_000);

    const reply = await bSocket
      .timeout(20_000)
      .emitWithAck("game:pass") as { ok: boolean; code?: string };
    assert.notEqual(
      reply.code,
      "NO_LIVE_GAME",
      "the surviving instance never took the table over — the hand died with " +
        "the process that dealt it"
    );
  });
});
