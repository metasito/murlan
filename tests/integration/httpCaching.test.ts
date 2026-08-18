// tests/integration/httpCaching.test.ts — compression on the responses the
// server sends. GET / works as the fixture here whether or not a web build
// is present: the Expo Go landing page (no dist/) and the SPA's index.html
// (with dist/) are both well over compression's 1 KB threshold.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";

describe("static asset compression and caching", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  test("a compressible response is gzipped when the client accepts it", async () => {
    const res = await fetch(`${server.url}/`, {
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), "gzip");
  });

  test("a client that does not accept gzip gets the raw response", async () => {
    const res = await fetch(`${server.url}/`, {
      headers: { "accept-encoding": "identity" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null);
  });
});
