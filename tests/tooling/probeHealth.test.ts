// tests/tooling/probeHealth.test.ts — the scheduled probe goes red for anything but a 200 whose body
// says this instance and both its dependencies are up.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

function probe(env: Record<string, string | undefined>): Promise<number | null> {
  const child = spawn(process.execPath, ["scripts/probe-health.mjs"], {
    env: { ...process.env, PROD_URL: undefined, ...env },
    stdio: "ignore",
  });
  return once(child, "exit").then(([code]) => code as number | null);
}

const UP = { status: "ok", db: "connected", redis: "connected", uptime: 1 };

test("an unset PROD_URL fails", async () => {
  assert.equal(await probe({}), 1);
});

for (const [label, status, body, exit] of [
  ["a 200 with both links up", 200, UP, 0],
  ["a 503", 503, UP, 1],
  ['a 200 carrying db:"down"', 200, { ...UP, db: "down" }, 1],
  ['a 200 carrying redis:"down"', 200, { ...UP, redis: "down" }, 1],
  ["a 200 with an empty body", 200, {}, 1],
  ["a 200 that is not JSON", 200, "ok", 1],
] as const) {
  test(`${label} exits ${exit}`, async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === "/health" ? status : 404;
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      assert.equal(await probe({ PROD_URL: `http://127.0.0.1:${port}` }), exit);
    } finally {
      server.close();
    }
  });
}
