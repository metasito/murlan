import assert from "node:assert/strict";
import { io as ioClient, type Socket } from "socket.io-client";
import type { TestServer } from "./testServer.ts";
import type { z } from "zod";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type IntentEvent,
  type IntentPayload,
  type IntentReply,
  type IntentSchemas,
  type ServerToClientEvents,
} from "../../shared/protocol.ts";
import type { Move } from "../../lib/game/gameEngine.ts";
import { db } from "../../server/store/db.ts";
import { authTokens } from "../../shared/schema.ts";
import { eq, and } from "drizzle-orm";

export const PROTOCOL_AUTH = { protocolVersion: PROTOCOL_VERSION };

type Ack = (reply: IntentReply) => void;
type Sent<E extends IntentEvent> = IntentPayload<E> & { intentId?: string };

/**
 * `ClientToServerEvents` with the ack left optional, and the payload too where the schema accepts
 * none: the app always awaits an answer, a test often fires and watches the broadcast instead.
 */
export type TestEmits = {
  [E in IntentEvent]: undefined extends z.input<IntentSchemas[E]>
    ? (message?: Sent<E>, ack?: Ack) => void
    : (message: Sent<E>, ack?: Ack) => void;
} & {
  "friend:invite": (invite: Parameters<ClientToServerEvents["friend:invite"]>[0], ack?: Ack) => void;
  "friend:get_online_list": (payload?: Record<string, never>, ack?: Ack) => void;
};

/** A client socket typed by the wire contract, so a payload is the server's own type. */
export type TestSocket = Socket<ServerToClientEvents, TestEmits>;

/** What the server sends, plus the one reserved event a test waits on. */
export type Incoming = keyof ServerToClientEvents | "disconnect";

export type Payload<E extends Incoming> = E extends keyof ServerToClientEvents
  ? Parameters<ServerToClientEvents[E]>[0]
  : string;

export interface RegisteredUser {
  id: string;
  username: string;
  email: string | null;
}

export async function register(
  server: TestServer,
  username: string
): Promise<{ user: RegisteredUser; cookie: string }> {
  const res = await fetch(`${server.url}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "password123", email: `${username.toLowerCase()}@example.test` }),
  });
  // `assert.equal` evaluates its message eagerly, so an inline `await res.text()` would consume the body on every call.
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

  // #897: the register reply is neutral; who was signed in is /api/auth/me's question, as the client asks it.
  const me = await fetch(`${server.url}/api/auth/me`, {
    headers: { cookie },
  });
  const meText = await me.text();
  assert.equal(me.status, 200, `register(${username}): /api/auth/me after registering: ${meText}`);
  return { user: JSON.parse(meText), cookie };
}

export interface SocketCredentials {
  ticket?: string;
  /** Handshakes on the session cookie instead of a ticket. */
  cookie?: string;
  origin?: string;
  /** Merged over the protocol version, for a suite probing what the handshake accepts. */
  auth?: Record<string, unknown>;
}

export type Opened = { ok: true; socket: TestSocket } | { ok: false; err: string };

/** The `turn` of the latest `game:state` each socket was sent: what `sendMove` names its move against. */
const latestTurn = new WeakMap<TestSocket, string>();

/** The one handshake: resolves either way, and a refused socket is already closed. */
export function openSocket(at: TestServer | string, how: SocketCredentials = {}): Promise<Opened> {
  const url = typeof at === "string" ? at : at.url;
  const headers: Record<string, string> = {};
  if (how.cookie) headers.cookie = how.cookie;
  if (how.origin) headers.origin = how.origin;
  const socket: TestSocket = ioClient(url, {
    auth: { ...PROTOCOL_AUTH, ...(how.ticket ? { ticket: how.ticket } : {}), ...how.auth },
    extraHeaders: headers,
    transports: ["websocket"],
    reconnection: false,
  });
  socket.on("game:state", (state) => latestTurn.set(socket, state.turn));
  return new Promise((resolve) => {
    socket.once("connect", () => resolve({ ok: true, socket }));
    socket.once("connect_error", (e) => {
      socket.close();
      resolve({ ok: false, err: e.message });
    });
  });
}

/** `openSocket` for a handshake that must be accepted. */
export async function connectSocket(at: TestServer | string, how: SocketCredentials): Promise<TestSocket> {
  const opened = await openSocket(at, how);
  if (!opened.ok) throw new Error(`the handshake was refused: ${opened.err}`);
  return opened.socket;
}

export async function socketTicket(server: TestServer | string, cookie: string): Promise<string> {
  const url = typeof server === "string" ? server : server.url;
  const res = await fetch(`${url}/api/auth/socket-ticket`, {
    method: "POST",
    headers: { cookie },
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return (JSON.parse(text) as { ticket: string }).ticket;
}

/**
 * A second socket for an account that already exists — a phone back from a dropped connection, on the
 * session it already holds. `connectAs` cannot give one: registering the same username twice is refused.
 */
export async function reconnectWith(server: TestServer, cookie: string): Promise<TestSocket> {
  return connectSocket(server, { ticket: await socketTicket(server, cookie) });
}

/** Whether the server closes `socket` within `ms`. */
export function dropped(socket: TestSocket, ms = 5_000): Promise<boolean> {
  return waitFor(socket, "disconnect", ms).then(
    () => true,
    () => false
  );
}

/**
 * Registers a fresh user, mints a socket ticket and connects. "connect" is the whole readiness signal:
 * the connection handler registers every listener before its first await (tests/integration/gameplay.test.ts).
 */
export async function connectAs(
  server: TestServer,
  username: string
): Promise<{ socket: TestSocket; user: RegisteredUser; cookie: string }> {
  const { user, cookie } = await register(server, username);
  return { socket: await reconnectWith(server, cookie), user, cookie };
}

/**
 * These deadlines fail a hung test loudly; none asserts how fast the server is. A shared runner is
 * several times slower than a developer machine, so every deadline scales instead of being retuned.
 * `SLOW_RUNNER_SCALE` is named on its own because a CI budget is judged against it from a machine
 * where `DEADLINE_SCALE` reads 1 (`tests/soak/gateBudget.ts`).
 */
export const SLOW_RUNNER_SCALE = 4;
export const DEADLINE_SCALE = process.env.CI ? SLOW_RUNNER_SCALE : 1;

/** The listener half of a socket, by event name alone: `Payload` is what types it. */
interface Listening {
  on(event: string, listener: (payload: never) => void): unknown;
  off(event: string, listener: (payload: never) => void): unknown;
}

/** The first `event` on `socket` whose payload `matches`. `ms` is the local budget, scaled by `DEADLINE_SCALE`. */
export function waitForWhere<E extends Incoming>(
  socket: TestSocket,
  event: E,
  matches: (payload: Payload<E>) => boolean,
  ms = 5000
): Promise<Payload<E>> {
  const on = socket as unknown as Listening;
  return new Promise((resolve, reject) => {
    const onEvent = (payload: Payload<E>) => {
      if (!matches(payload)) return;
      clearTimeout(timer);
      on.off(event, onEvent);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      on.off(event, onEvent);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms * DEADLINE_SCALE);
    on.on(event, onEvent);
  });
}

export function waitFor<E extends Incoming>(socket: TestSocket, event: E, ms = 5000): Promise<Payload<E>> {
  return waitForWhere(socket, event, () => true, ms);
}

/** `waitFor` for an event that may rightly never come: null once the scaled window passes. */
export function waitForOrNull<E extends Incoming>(socket: TestSocket, event: E, ms = 5000): Promise<Payload<E> | null> {
  return waitFor(socket, event, ms).catch(() => null);
}

/** Answers an intent with the server's own reply, failing loudly when none comes. */
export async function intent<E extends IntentEvent>(
  socket: TestSocket,
  event: E,
  payload?: Sent<E>,
  ms = 5_000
): Promise<IntentReply> {
  return untyped(socket).timeout(ms * DEADLINE_SCALE).emitWithAck(event, payload);
}

/** The one place a socket loses its wire types: a suite probing with what the contract refuses to type goes through it. */
const untyped = (socket: TestSocket) => socket as unknown as Socket;

export function emitUnchecked(socket: TestSocket, event: string, ...args: unknown[]): void {
  untyped(socket).emit(event, ...args);
}

/** `emitWithAck` for an event or payload the wire contract refuses to type; rejects when no ack comes within `ms` (scaled). */
export function ackUnchecked(socket: TestSocket, event: string, args: unknown[], ms = 5_000): Promise<unknown> {
  return untyped(socket).timeout(ms * DEADLINE_SCALE).emitWithAck(event, ...args);
}

/** Every connected socket leaves its room, and the server has answered each: a suite's teardown. */
export async function leaveRooms(sockets: (TestSocket | null | undefined)[]): Promise<void> {
  await Promise.allSettled(sockets.flatMap((s) => (s?.connected ? [intent(s, "room:leave")] : [])));
}

/**
 * The one test-side map from a `Move` to its socket intent. Never rejects: a driver fires it from a
 * listener, and a socket closed under it is the scenario, not a failure. A move the socket cannot
 * carry, or that is lost when it closes, resolves `{ ok: false, code: "SOCKET_CLOSED" }`. The move
 * names the turn of the latest state the socket saw, unless `opts.turn` names another; a socket that
 * has seen none cannot move. `opts.intentId` sends it as a retry of the intent that id names.
 */
export function sendMove(
  socket: TestSocket,
  move: Move,
  opts: { intentId?: string; turn?: string } = {}
): Promise<IntentReply> {
  const closed: IntentReply = { ok: false, code: "SOCKET_CLOSED" };
  if (!socket.connected) return Promise.resolve(closed);
  const turn = opts.turn ?? latestTurn.get(socket);
  assert.ok(turn !== undefined, "sendMove: this socket has been sent no game:state to name a turn from");
  const id = opts.intentId === undefined ? {} : { intentId: opts.intentId };
  return new Promise((resolve) => {
    const gone = () => resolve(closed);
    socket.once("disconnect", gone);
    const ack = (reply: IntentReply) => {
      socket.off("disconnect", gone);
      resolve(reply);
    };
    if (move.kind === "play") socket.emit("game:play", { cardIds: move.cardIds, turn, ...id }, ack);
    else if (move.kind === "pass") socket.emit("game:pass", { turn, ...id }, ack);
    else socket.emit("game:exchange_give_card", { cardId: move.cardId, turn, ...id }, ack);
  });
}

/**
 * Resolves once the server has finished every intent `socket` sent before this, and every packet it
 * sent the socket meanwhile has arrived. One socket's intents run in order (`onEvent`'s queue,
 * server/socket/socketSafety.ts), so the answer to a read-only intent is a barrier behind them.
 */
export async function settled(socket: TestSocket, ms = 5_000): Promise<void> {
  await socket.timeout(ms * DEADLINE_SCALE).emitWithAck("friend:get_online_list", {});
}

/** How long absence is observed for. Absence has no event to await, so this is real time. */
export const QUIET_MS = 300;

/**
 * Resolves when no `event` (that `matches`) reaches `socket` over `QUIET_MS` and a `settled` barrier,
 * and rejects with the payload that did. Subscribes synchronously: start it before the action whose
 * consequence must not arrive.
 */
export function nothingArrives<E extends Incoming>(
  socket: TestSocket,
  event: E,
  opts: { ms?: number; matches?: (payload: Payload<E>) => boolean; why?: string } = {}
): Promise<void> {
  const on = socket as unknown as Listening;
  const matches = opts.matches ?? (() => true);
  const arrived: Payload<E>[] = [];
  const onEvent = (payload: Payload<E>) => {
    if (matches(payload)) arrived.push(payload);
  };
  on.on(event, onEvent);
  return (async () => {
    try {
      await new Promise((r) => setTimeout(r, (opts.ms ?? QUIET_MS) * DEADLINE_SCALE));
      if (arrived.length === 0 && socket.connected) await settled(socket);
    } finally {
      on.off(event, onEvent);
    }
    if (arrived.length > 0) {
      const what = `"${event}" arrived when nothing should have: ${JSON.stringify(arrived[0])}`;
      throw new Error(opts.why ? `${opts.why} — ${what}` : what);
    }
  })();
}

/** Every pause between `eventually`'s reads; a read that shows nothing yet is retried after it. */
const POLL_MS = 25;

/**
 * Resolves with `check`'s first truthy result, rereading until `ms` (scaled) runs out. For state that
 * nothing announces — a row written fire-and-forget, a lock queue, a timer armed in-process.
 */
export async function eventually<T>(
  check: () => T | Promise<T>,
  what = "the state the test polls for",
  ms = 5_000
): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms * DEADLINE_SCALE;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * register() replies before it mints (#897), and its mint replaces every pending code — so a test
 * minting its own must wait for register's to land, or register's can delete it afterwards.
 */
export async function waitForPendingCode(userId: string): Promise<void> {
  await eventually(
    async () =>
      (
        await db()
          .select()
          .from(authTokens)
          .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, "email_verify")))
      ).length > 0,
    `register's background mint for ${userId}`
  );
}
