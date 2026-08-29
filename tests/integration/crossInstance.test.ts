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
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import { hasDatabase, skipMessage } from "../helpers/testServer.ts";

const PORTS = [5561, 5562] as const;
/** Short, so the "was it re-sent?" window below is seconds rather than tens. */
const ACK_TIMEOUT_MS = 700;

interface Instance {
  port: number;
  child: ChildProcess;
}

function boot(port: number, databaseUrl: string): Promise<Instance> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "server/index.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PORT: String(port),
          SESSION_SECRET: "cross-instance-secret",
          LOG_LEVEL: "silent",
          NODE_ENV: "development",
          MURLAN_STATE_ACK_TIMEOUT_MS: String(ACK_TIMEOUT_MS),
          // Nothing here plays a hand; an AFK auto-move mid-assertion would be
          // state arriving for a reason that is not a re-send.
          MURLAN_AFK_TIMEOUT_MS: "600000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const giveUp = setTimeout(
      () => reject(new Error(`instance on ${port} never came up`)),
      45_000
    );
    const watch = (buf: unknown) => {
      const line = String(buf);
      if (line.includes(String(port)) || line.includes("listening")) {
        clearTimeout(giveUp);
        // The port is logged from the listen callback; the socket server is
        // attached by then, but the adapter's LISTEN is still in flight.
        setTimeout(() => resolve({ port, child }), 600);
      }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
  });
}

async function register(port: number, username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "cross-instance-pw" }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `register ${username}: ${text}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

function connectSocket(port: number, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
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
    for (const port of PORTS) instances.push(await boot(port, scoped));

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

    const second = await connectSocket(PORTS[1], extraCookie);
    sockets.push(second);

    assert.notEqual(
      await dropped,
      "still connected",
      "the socket on the other instance stayed live — one account now has two"
    );
    assert.equal(second.connected, true, "the arriving socket must be the one that survives");
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
});
