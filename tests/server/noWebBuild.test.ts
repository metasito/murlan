import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { __testables } from "../../server/app.ts";

const PLATFORMS = ["ios", "android"];
const PLANTED = '{"planted":"an Expo Go manifest"}';
const root = mkdtempSync(path.join(tmpdir(), "murlan-no-web-build-"));
const home = process.cwd();
let server: Server;
let base = "";

// A manifest and bundle directory where the old Expo Go deployment put them, so
// a route that still serves them has something to serve.
before(async () => {
  for (const platform of PLATFORMS) {
    mkdirSync(path.join(root, "static-build", platform), { recursive: true });
    writeFileSync(path.join(root, "static-build", platform, "manifest.json"), PLANTED);
  }
  process.chdir(root);
  process.env.MURLAN_WEB_DIST = path.join(root, "dist");
  const app = express();
  __testables.configureWebBuild(app);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  process.chdir(home);
  delete process.env.MURLAN_WEB_DIST;
  rmSync(root, { recursive: true, force: true });
});

test("with no web build, / says the web build is missing", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 503);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(await res.text(), /web build/i);
});

for (const platform of PLATFORMS) {
  test(`an expo-platform: ${platform} request gets no manifest`, async () => {
    for (const route of ["/", "/manifest"]) {
      const res = await fetch(`${base}${route}`, { headers: { "expo-platform": platform } });
      const body = await res.text();
      assert.notEqual(body, PLANTED, `${route} served the Expo Go manifest`);
      assert.ok(res.status >= 400, `${route} answered ${res.status}`);
    }
  });

  test(`static-build/${platform} is not served`, async () => {
    const res = await fetch(`${base}/${platform}/manifest.json`);
    assert.notEqual(await res.text(), PLANTED);
    assert.equal(res.status, 404);
  });
}
