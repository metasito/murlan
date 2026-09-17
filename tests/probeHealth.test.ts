// tests/probeHealth.test.ts — the scheduled probe goes red for anything but a 200.
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

test("an unset PROD_URL fails", async () => {
  assert.equal(await probe({}), 1);
});

for (const [status, exit] of [[200, 0], [503, 1]] as const) {
  test(`a ${status} exits ${exit}`, async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = req.url === "/health" ? status : 404;
      res.end("{}");
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
