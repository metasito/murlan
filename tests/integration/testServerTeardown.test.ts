import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

/**
 * Its own file: `server/db.ts`'s Pool is a module singleton that `stop()` ends,
 * so a second `startTestServer()` in this process boots against a closed pool.
 *
 * Ten seconds against the harness's two-minute keep-alive — outside any honest
 * teardown, well inside a wait for one.
 */
test("stop() does not wait out a response nobody read", { timeout: 10_000 }, async (t) => {
  if (!hasDatabase()) {
    t.skip(skipMessage());
    return;
  }

  const server = await startTestServer();
  const { cookie } = await register(server, `teardown_${`${Date.now()}`.slice(-8)}`);
  // Asserting on a status and never reading the body is ordinary, and it leaves
  // the socket busy rather than idle.
  await fetch(`${server.url}/api/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message: "" }),
  });

  const open = await new Promise<number>((resolve, reject) =>
    server.httpServer.getConnections((err, count) => (err ? reject(err) : resolve(count)))
  );
  // Without this the test passes on any client that releases the socket by
  // itself, having proved nothing about the server that would still be waiting.
  assert.ok(open > 0, "no connection was left open, so this proves nothing about closing one");

  await server.stop();
});
