// The three answers L-054 found wrong, each pinned without a database: the store
// is stubbed and express-session is stood in for, so only the route's own
// decision is under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import { mountApi } from "../../server/http/routes/index.ts";
import { userStore } from "../../server/store/userStore.ts";
import { handshakeSession } from "../../server/socket/socket.ts";
import { AUTH_UNAVAILABLE } from "../../shared/protocol.ts";

interface FakeSession {
  userId?: string;
  destroy(cb: (err?: Error) => void): void;
}

async function serve(session: () => FakeSession) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: session(), sessionID: "sid-1" });
    next();
  });
  mountApi(app);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("/me for an account deleted under its session answers 401 NOT_AUTHENTICATED", async (t) => {
  t.mock.method(userStore, "getUser", async () => undefined);
  const { url, close } = await serve(() => ({ userId: "gone", destroy: (cb) => cb() }));
  try {
    const res = await fetch(`${url}/api/auth/me`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { code: string }).code, "NOT_AUTHENTICATED");
  } finally {
    await close();
  }
});

test("logout whose session.destroy fails answers 500, not ok", async () => {
  const { url, close } = await serve(() => ({ userId: "u1", destroy: (cb) => cb(new Error("store down")) }));
  try {
    const res = await fetch(`${url}/api/auth/logout`, { method: "POST" });
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { code: string }).code, "INTERNAL_SERVER_ERROR");
  } finally {
    await close();
  }
});

test("logout whose session.destroy succeeds still answers ok", async () => {
  const { url, close } = await serve(() => ({ userId: "u1", destroy: (cb) => cb() }));
  try {
    const res = await fetch(`${url}/api/auth/logout`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await close();
  }
});

test("a handshake whose session store errors is refused AUTH_UNAVAILABLE, not the driver's message", () => {
  const failing: express.RequestHandler = (_req, _res, next) => next(new Error("connection terminated unexpectedly"));
  let refused: Error | undefined;
  handshakeSession(failing)({ request: {} as IncomingMessage }, (err) => {
    refused = err;
  });
  assert.equal(refused?.message, AUTH_UNAVAILABLE);
});

test("a handshake whose session loads passes through", () => {
  const loaded: express.RequestHandler = (_req, _res, next) => next();
  let called = false;
  let refused: Error | undefined;
  handshakeSession(loaded)({ request: {} as IncomingMessage }, (err) => {
    called = true;
    refused = err;
  });
  assert.ok(called);
  assert.equal(refused, undefined);
});
