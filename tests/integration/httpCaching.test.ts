// tests/integration/httpCaching.test.ts — bytes actually saved on the wire.
//
// Two properties of the static-asset path in server/app.ts, both of which
// live only in response headers and so need a real booted server: a
// compressible response is gzipped for a client that accepts it, and a URL
// under dist/ is cached for a year exactly when its filename carries a content
// hash.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";

// This suite serves a synthetic dist/ tree. node --test runs files concurrently
// and every other integration suite's server reads dist/ from process.cwd() too,
// so the tree is built in a directory of this suite's own and cwd moves onto it
// for the life of the server — writing into the real one raced them.
const ASSET_DIR = path.join("_expo", "static", "js", "web");
const ASSET_NAME = "app-fixture.deadbeefcafebabe0123456789abcdef.js";

// The server refuses to serve dist/ at all without an index.html.
const FIXTURE_INDEX_HTML = `<!doctype html><div id="root"></div>`;
// Large enough to clear compression's default 1 KB threshold.
const FIXTURE_JS = `// synthetic content-hashed asset\n${"x".repeat(4000)}`;
// Only its URL matters here, not its bytes — the browser fetches /favicon.ico
// on every visit and the header it comes back with is the whole point.
const FIXTURE_FAVICON = Buffer.from("00000100", "hex");

describe("static asset compression and caching", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let originalCwd: string;
  let sandbox: string;

  before(async () => {
    // Inside before(), not at module scope: a skipped describe still evaluates
    // the module, and after() — which is what removes this — does not run.
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-http-"));
    const distDir = path.join(sandbox, "dist");
    const assetDir = path.join(distDir, ASSET_DIR);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), FIXTURE_INDEX_HTML);
    fs.writeFileSync(path.join(distDir, "favicon.ico"), FIXTURE_FAVICON);
    fs.writeFileSync(path.join(assetDir, ASSET_NAME), FIXTURE_JS);

    originalCwd = process.cwd();
    process.chdir(sandbox);
    server = await startTestServer();
  });

  after(async () => {
    try {
      if (server) await server.stop();
    } finally {
      try {
        if (originalCwd) process.chdir(originalCwd);
      } finally {
        if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
      }
    }
  });

  const assetUrl = () => `${server.url}/_expo/static/js/web/${ASSET_NAME}`;

  test("a compressible response is gzipped when the client accepts it", async () => {
    const res = await fetch(assetUrl(), {
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), "gzip");
  });

  test("a client that does not accept gzip gets the raw response", async () => {
    const res = await fetch(assetUrl(), {
      headers: { "accept-encoding": "identity" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null);
  });

  test("a content-hashed asset is cached long and immutably", async () => {
    const res = await fetch(assetUrl());
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("cache-control"),
      "public, max-age=31536000, immutable"
    );
  });

  test("the HTML entry point is not cached — it names the current hashed bundle", async () => {
    const res = await fetch(`${server.url}/`);
    assert.equal(res.status, 200);
    const cacheControl = res.headers.get("cache-control");
    assert.ok(
      cacheControl && /no-cache/.test(cacheControl),
      `expected a no-cache directive on index.html, got ${cacheControl}`
    );
  });

  // A bookmark, a pasted link or an SEO-normalised URL asks for the entry
  // point by name, which is a different code path from "/".
  test("the HTML entry point is not cached when asked for by name either", async () => {
    const res = await fetch(`${server.url}/index.html`);
    assert.equal(res.status, 200);
    const cacheControl = res.headers.get("cache-control");
    assert.ok(
      cacheControl && /no-cache/.test(cacheControl),
      `expected a no-cache directive on /index.html, got ${cacheControl}`
    );
  });

  // helmet is mounted before either branch of configureExpoAndLanding, so the
  // header does not depend on which of the SPA and the landing page serves "/".
  // Asserted on a static route and a handler route to show it is app-wide.
  test("every response carries the CSP", async () => {
    for (const route of ["/", "/health"]) {
      const res = await fetch(`${server.url}${route}`);
      const csp = res.headers.get("content-security-policy");
      assert.ok(csp, `no Content-Security-Policy on ${route}`);
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src [^;]*https:\/\/unpkg\.com/);
      assert.match(csp, /object-src 'none'/);
      assert.equal(/upgrade-insecure-requests/.test(csp), false);
    }
  });

  test("an unhashed asset under dist/ is not cached — its URL outlives its bytes", async () => {
    const res = await fetch(`${server.url}/favicon.ico`);
    assert.equal(res.status, 200);
    const cacheControl = res.headers.get("cache-control");
    assert.ok(
      cacheControl && /no-cache/.test(cacheControl),
      `expected a no-cache directive on /favicon.ico, got ${cacheControl}`
    );
  });
});
