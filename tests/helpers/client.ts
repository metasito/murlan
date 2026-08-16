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
  assert.equal(res.status, 200, text);
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
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (e) => reject(e));
  });
  // The server's connection handler does `await storage.getFriends(userId)`
  // (to emit friend:online_list) before it registers the room:*/game:*
  // listeners below it — a room:create fired the instant the client sees
  // "connect" can land before those listeners exist and be silently
  // dropped. friend:online_list is emitted right before that synchronous
  // registration block runs (no further await in between), so waiting for
  // it here is a reliable "the server is ready for game/room events" signal
  // for every caller of connectAs, not just a fixed sleep.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for friend:online_list after connect")),
      5_000
    );
    socket.once("friend:online_list", () => {
      clearTimeout(timer);
      resolve();
    });
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
