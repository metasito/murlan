import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_ALIVE_MS, hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";

/**
 * Its own file: `startTestServer()`'s pool is module-scoped, so a second boot
 * after any `stop()` in the same process cannot open one.
 */

/** What `fetch`'s own agent will keep an idle socket for. */
const UNDICI_KEEP_ALIVE_MS = 4_000;

test("the test server outlasts the client's idle connection", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  // Merely outlasting the client is what Node's own default already does, and
  // one second of slack is inside the delay a saturated runner adds to both
  // timers. The server has to be far enough from closing that the order of the
  // two cannot come into question.
  assert.ok(
    KEEP_ALIVE_MS > UNDICI_KEEP_ALIVE_MS * 10,
    `holding an idle socket for ${KEEP_ALIVE_MS}ms is too close to the ` +
      `${UNDICI_KEEP_ALIVE_MS}ms the client goes on reusing it`
  );

  const server = await startTestServer();
  try {
    assert.equal(
      server.httpServer.keepAliveTimeout,
      KEEP_ALIVE_MS,
      "the constant has to reach the server it is written for"
    );
    assert.ok(
      server.httpServer.headersTimeout > server.httpServer.keepAliveTimeout,
      "Node requires headersTimeout to outlast keepAliveTimeout"
    );
  } finally {
    await server.stop();
  }
});
