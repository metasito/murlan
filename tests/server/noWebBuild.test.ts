import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { __testables } from "../../server/app.ts";

const PLATFORMS = ["ios", "android"];
const PLANTED = '{"planted":"a static-build manifest"}';
const root = mkdtempSync(path.join(tmpdir(), "murlan-no-web-build-"));
const home = process.cwd();
let server: http.Server;
let port = 0;

// Manifests where the retired static deployment put them, so a route that
// still serves them has something to serve.
before(async () => {
  for (const platform of PLATFORMS) {
    mkdirSync(path.join(root, "static-build", platform), { recursive: true });
    writeFileSync(path.join(root, "static-build", platform, "manifest.json"), PLANTED);
  }
  process.chdir(root);
  const app = express();
  __testables.configureWebBuild(app);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  process.chdir(home);
  rmSync(root, { recursive: true, force: true });
});

/** `agent: false`, as in `tests/server/logRedaction.test.ts`: a pooled socket aborts `--test-force-exit`. */
function get(target: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: target, headers, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"] ?? "", body }));
    });
    req.on("error", reject);
  });
}

test("with no web build, / says the web build is missing", async () => {
  const res = await get("/");
  assert.equal(res.status, 503);
  assert.match(res.type, /^text\/plain/);
  assert.match(res.body, /web build/i);
});

for (const platform of PLATFORMS) {
  test(`an expo-platform: ${platform} request gets no manifest`, async () => {
    for (const route of ["/", "/manifest"]) {
      const res = await get(route, { "expo-platform": platform });
      assert.notEqual(res.body, PLANTED, `${route} served the planted manifest`);
      assert.ok(res.status >= 400, `${route} answered ${res.status}`);
    }
  });

  test(`static-build/${platform} is not served`, async () => {
    const res = await get(`/${platform}/manifest.json`);
    assert.notEqual(res.body, PLANTED);
    assert.equal(res.status, 404);
  });
}
