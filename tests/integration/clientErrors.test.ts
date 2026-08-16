// tests/integration/clientErrors.test.ts — the crash-report endpoint.
//
// This is the only route that takes attacker-controlled free text and writes it
// straight into the server log, so its limits are the whole point of it. An
// unbounded stack field is a way to fill a disk, and an unauthenticated one is
// open log injection. Both are asserted here against the real server rather
// than inferred from the schema.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("client crash reports", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let cookie: string;

  before(async () => {
    server = await startTestServer();
    ({ cookie } = await register(server, "crash_reporter"));
  });
  after(async () => {
    await server.stop();
  });

  function post(body: unknown, withCookie = true) {
    return fetch(`${server.url}/api/client-errors`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withCookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test("an authenticated report is accepted", async () => {
    const res = await post({
      message: "Cannot read property 'cards' of null",
      stack: "at GameTable (components/GameTable.tsx:1)",
      platform: "ios",
    });
    assert.equal(res.status, 204, await res.text());
  });

  test("an unauthenticated report is refused", async () => {
    // Otherwise anyone on the internet can write arbitrary text into the log.
    const res = await post({ message: "injected" }, false);
    assert.equal(res.status, 401);
  });

  test("an oversized stack is refused rather than truncated silently", async () => {
    const res = await post({ message: "boom", stack: "x".repeat(4001) });
    assert.equal(res.status, 400);
  });

  test("an oversized message is refused", async () => {
    const res = await post({ message: "x".repeat(501) });
    assert.equal(res.status, 400);
  });

  test("an empty message is refused — it diagnoses nothing", async () => {
    const res = await post({ message: "" });
    assert.equal(res.status, 400);
  });

  test("an unknown platform is refused", async () => {
    const res = await post({ message: "boom", platform: "symbian" });
    assert.equal(res.status, 400);
  });

  test("a crash loop is rate limited rather than allowed to flood the log", async () => {
    const { cookie: loopCookie } = await register(server, "crash_looper");
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${server.url}/api/client-errors`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: loopCookie },
        body: JSON.stringify({ message: `crash ${i}` }),
      });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.includes(429),
      `expected a 429 once the burst limit is hit, got ${statuses.join(",")}`
    );
  });
});
