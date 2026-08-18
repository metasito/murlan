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
    body: JSON.stringify({ username, password: "password123" }),
  });
  // Read the body once as text: `assert.equal`'s message argument is
  // evaluated eagerly regardless of pass/fail, so `await res.text()` inline
  // as the third arg would consume the stream every time and leave nothing
  // for a later `res.json()` call.
  const text = await res.text();
  assert.equal(
    res.status,
    200,
    res.status === 429
      ? `register(${username}) hit the /api/auth/register cap — raise ` +
          `MURLAN_AUTH_RATE_LIMIT in tests/helpers/testServer.ts: ${text}`
      : text
  );
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "register() response must set a session cookie");
  return { user: JSON.parse(text), cookie };
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
 * Waits for a single occurrence of `event` on `socket`, timing out loudly
 * instead of letting a hung test stall the suite.
 */
export function waitFor<T = unknown>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      ms
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
