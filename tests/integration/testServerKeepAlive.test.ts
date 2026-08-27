import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";

/**
 * Node closes an idle keep-alive socket after 5s; undici keeps reusing one for
 * 4s. The second between them is the whole safety margin, and on a loaded
 * runner both timers fire late and out of order — so a request goes down a
 * socket the server has already begun closing and `fetch` rejects with
 * `UND_ERR_SOCKET: other side closed`. Whichever test was holding that
 * connection goes red for something none of its assertions is about (#424).
 *
 * Its own file: `startTestServer()`'s pool is module-scoped, so a second boot
 * after any `stop()` in the same process cannot open one.
 */

/** What `fetch`'s own agent will keep an idle socket for. */
const UNDICI_KEEP_ALIVE_MS = 4_000;
/**
 * Merely outlasting the client is what Node's 5s default already does, and it
 * is not enough: one second of slack is inside the scheduling delay a
 * saturated runner adds to both timers. The server has to be so far from
 * closing that the ordering cannot come into question.
 */
const MARGIN = 10;

test("the test server outlasts the client's idle connection", async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const server = await startTestServer();
  try {
    assert.ok(
      server.httpServer.keepAliveTimeout >= UNDICI_KEEP_ALIVE_MS * MARGIN,
      `the server drops an idle socket after ${server.httpServer.keepAliveTimeout}ms, ` +
        `too close to the ${UNDICI_KEEP_ALIVE_MS}ms the client goes on reusing it for the ` +
        `order of the two to be certain`
    );
    assert.ok(
      server.httpServer.headersTimeout > server.httpServer.keepAliveTimeout,
      "Node requires headersTimeout to outlast keepAliveTimeout"
    );
  } finally {
    await server.stop();
  }
});
