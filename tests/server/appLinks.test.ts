import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { __testables } from "../../server/app.ts";
import appJson from "../../app.json" with { type: "json" };

const SHELL = "<!doctype html><title>the SPA shell</title>";
const AASA = "/.well-known/apple-app-site-association";
const ASSETLINKS = "/.well-known/assetlinks.json";
const CERT = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const home = process.cwd();
const roots: string[] = [];
const servers: http.Server[] = [];
const ports = { web: 0, bare: 0 };

async function listen(withWebBuild: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), "murlan-app-links-"));
  roots.push(root);
  if (withWebBuild) {
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "dist", "index.html"), SHELL);
  }
  process.chdir(root);
  const app = express();
  __testables.configureWebBuild(app);
  const server = app.listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return (server.address() as AddressInfo).port;
}

before(async () => {
  ports.web = await listen(true);
  ports.bare = await listen(false);
  process.chdir(home);
});

afterEach(() => {
  delete process.env.APPLE_TEAM_ID;
  delete process.env.ANDROID_CERT_SHA256;
});

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** `agent: false`, as in `tests/server/logRedaction.test.ts`: a pooled socket aborts `--test-force-exit`. */
function get(port: number, target: string) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: target, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: res.headers["content-type"] ?? "", body }));
    });
    req.on("error", reject);
  });
}

test("the fixture's SPA shell answers an unknown path, so a fall-through would show", async () => {
  const res = await get(ports.web, "/join/ABCDEF");
  assert.equal(res.status, 200);
  assert.equal(res.body, SHELL);
});

for (const [label, port] of [["with a web build", "web"], ["without a web build", "bare"]] as const) {
  test(`${label}, both files answer 404 while their env value is unset`, async () => {
    for (const target of [AASA, ASSETLINKS]) {
      const res = await get(ports[port], target);
      assert.equal(res.status, 404, target);
      assert.notEqual(res.body, SHELL, target);
    }
  });

  test(`${label}, the apple-app-site-association names the team's app and /join/*`, async () => {
    process.env.APPLE_TEAM_ID = "TEAM123456";
    const res = await get(ports[port], AASA);
    assert.equal(res.status, 200);
    assert.match(res.type, /^application\/json/);
    assert.deepEqual(JSON.parse(res.body), {
      applinks: {
        details: [{ appIDs: [`TEAM123456.${appJson.expo.ios.bundleIdentifier}`], components: [{ "/": "/join/*" }] }],
      },
    });
  });

  test(`${label}, assetlinks.json delegates handle_all_urls to the package's certificate`, async () => {
    process.env.ANDROID_CERT_SHA256 = CERT;
    const res = await get(ports[port], ASSETLINKS);
    assert.equal(res.status, 200);
    assert.match(res.type, /^application\/json/);
    assert.deepEqual(JSON.parse(res.body), [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: appJson.expo.android.package, sha256_cert_fingerprints: [CERT] },
      },
    ]);
  });
}
