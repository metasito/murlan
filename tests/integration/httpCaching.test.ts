// tests/integration/httpCaching.test.ts — bytes actually saved on the wire.
//
// PERF-01: nothing compressed a response, so every web visitor downloaded the
// raw bundle. PERF-09: every static asset — including the content-hashed
// build output that can never change under its own URL — was served with
// serve-static's default max-age=0, forcing a conditional request on every
// repeat visit.
//
// Both live in the same file because they touch the same code path
// (configureExpoAndLanding in server/testApp.ts) and were fixed in the same
// edit session. dist/ is a gitignored build product that CI does not have
// yet when this suite runs (the web bundle is built later in the workflow),
// so a synthetic dist/ is assembled in before() and torn back down in
// after() — restoring, not deleting, anything that was already there.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";

const distDir = path.resolve(process.cwd(), "dist");
const indexPath = path.join(distDir, "index.html");
const assetDir = path.join(distDir, "_expo", "static", "js", "web");
const assetPath = path.join(
  assetDir,
  "app-fixture.deadbeefcafebabe0123456789abcdef.js"
);

// Large enough to clear compression's default 1 KB threshold, so the
// compression assertions and the caching assertions can share one fixture.
const FIXTURE_INDEX_HTML = `<!doctype html><div id="root"></div><!-- ${"x".repeat(2000)} -->`;
const FIXTURE_JS = `// synthetic content-hashed asset\n${"x".repeat(4000)}`;

describe("static asset compression and caching", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const createdDirs: string[] = [];
  let restoreIndex: (() => void) | null = null;

  before(async () => {
    for (const dir of [
      distDir,
      path.join(distDir, "_expo"),
      path.join(distDir, "_expo", "static"),
      path.join(distDir, "_expo", "static", "js"),
      assetDir,
    ]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        createdDirs.push(dir);
      }
    }

    if (fs.existsSync(indexPath)) {
      const original = fs.readFileSync(indexPath, "utf-8");
      restoreIndex = () => fs.writeFileSync(indexPath, original);
    } else {
      restoreIndex = () => fs.rmSync(indexPath, { force: true });
    }
    fs.writeFileSync(indexPath, FIXTURE_INDEX_HTML);
    fs.writeFileSync(assetPath, FIXTURE_JS);

    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(assetPath, { force: true });
    restoreIndex?.();
    for (const dir of createdDirs.reverse()) {
      try {
        fs.rmdirSync(dir);
      } catch {
        // Not empty — something else is using it, leave it alone.
      }
    }
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

  test("a content-hashed asset is cached long and immutably", async () => {
    const res = await fetch(
      `${server.url}/_expo/static/js/web/app-fixture.deadbeefcafebabe0123456789abcdef.js`
    );
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
});
