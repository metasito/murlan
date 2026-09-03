import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import type { TestServer } from "./testServer.ts";

/**
 * Shared low-level test client helpers for integration suites, so each
 * suite doesn't have to copy-paste them.
 */

export interface RegisteredUser {
  id: string;
  username: string;
}

export async function register(
  server: TestServer,
  username: string
): Promise<{ user: RegisteredUser; cookie: string }> {
  const res = await fetch(`${server.url}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Username is already unique per call, so deriving the (also unique)
    // email from it needs no extra bookkeeping here.
    body: JSON.stringify({ username, password: "password123", email: `${username.toLowerCase()}@example.test` }),
  });
  // Read the body once as text: `assert.equal`'s message argument is
  // evaluated eagerly regardless of pass/fail, so `await res.text()` inline
  // as the third arg would consume the stream every time and leave nothing
  // for a later `res.json()` call.
  const text = await res.text();
  assert.equal(
    res.status,
    202,
    res.status === 429
      ? `register(${username}) hit the /api/auth/register cap — raise ` +
          `MURLAN_AUTH_RATE_LIMIT in tests/helpers/testServer.ts: ${text}`
      : text
  );
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "register() response must set a session cookie");

  // #897: the register response body is the same neutral
  // { ok, code: "CHECK_YOUR_EMAIL" } regardless of which account this
  // turned out to be — who actually got signed in is GET /api/auth/me's
  // question, same as the client asks it (context/AuthContext.tsx).
  const me = await fetch(`${server.url}/api/auth/me`, {
    headers: { cookie },
  });
  const meText = await me.text();
  assert.equal(me.status, 200, `register(${username}): /api/auth/me after registering: ${meText}`);
  return { user: JSON.parse(meText), cookie };
}

/** Raw handshake helper: connects with an arbitrary `auth` payload without
 * asserting success, so auth tests can probe rejected/forged credentials. */
export function connect(
  server: TestServer,
  auth: Record<string, unknown>
): Promise<{ ok: boolean; err?: string; socket?: Socket }> {
  return new Promise((resolve) => {
    const s = ioClient(server.url, { auth, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve({ ok: true, socket: s }));
    s.on("connect_error", (e) => {
      s.close();
      resolve({ ok: false, err: e.message });
    });
  });
}

/**
 * Registers a fresh user, mints a socket ticket and connects — the
 * authenticated-client path every gameplay test needs.
 *
 * The session cookie comes back too: a suite that asserts on both the socket
 * and a REST route (replays, ratings) would otherwise have to register the
 * same person twice and end up with two accounts.
 */
/**
 * A second socket for an account that already exists, which `connectAs` cannot
 * give: registering the same username twice is refused. This is what a phone
 * coming back from a dropped connection does — a fresh ticket on the session it
 * already holds.
 */
export async function reconnectWith(server: TestServer, cookie: string): Promise<Socket> {
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
    socket.once("connect_error", (e) => {
      // Nothing else holds a reference once this throws — the caller never
      // gets the socket, so closing here is the only chance to release it.
      socket.close();
      reject(e);
    });
  });
  return socket;
}

export async function connectAs(
  server: TestServer,
  username: string
): Promise<{ socket: Socket; user: RegisteredUser; cookie: string }> {
  const { user, cookie } = await register(server, username);
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
  // "connect" is the whole readiness signal. The connection handler registers
  // every room:*/game:* listener synchronously before its first await
  // (server/socket.ts, the block above the reconnect notice), so a packet
  // emitted the instant the transport is up already has a listener waiting.
  // tests/integration/gameplay.test.ts pins that directly.
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (e) => reject(e));
  });
  return { socket, user, cookie };
}

/**
 * A second socket for an account that already registered — the returning half
 * of a drop. `connectAs` would register a new user, and the register route is
 * rate limited per process, so the cookie is reused for a fresh ticket.
 */
export async function reconnectAs(
  server: TestServer,
  client: { cookie: string }
): Promise<Socket> {
  const res = await fetch(`${server.url}/api/auth/socket-ticket`, {
    method: "POST",
    headers: { cookie: client.cookie },
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
    socket.once("connect_error", (e) => {
      socket.close();
      reject(e);
    });
  });
  return socket;
}

/**
 * These deadlines exist to fail a hung test loudly rather than stall the
 * suite; none of them asserts how fast the server is. A shared runner is
 * several times slower than a developer machine — this suite takes 134s
 * locally and 238s on CI — and the socket tests deliberately saturate the
 * connect path, so a budget chosen against local latency fails on load while
 * nothing is wrong. Every deadline scales instead of each one being retuned.
 */
export const DEADLINE_SCALE = process.env.CI ? 4 : 1;

/**
 * Waits for a single occurrence of `event` on `socket`, timing out loudly
 * instead of letting a hung test stall the suite. `ms` is the local budget;
 * it is scaled by `DEADLINE_SCALE`.
 */
export function waitFor<T = unknown>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      ms * DEADLINE_SCALE
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
