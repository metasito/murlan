// tests/integration/httpCaching.test.ts — bytes actually saved on the wire.
//
// Two properties of the static-asset path in server/testApp.ts, both of which
// live only in response headers and so need a real booted server: a
// compressible response is gzipped for a client that accepts it, and a URL
// under dist/ is cached for a year exactly when its filename carries a content
// hash.
//
// dist/ is a gitignored build product that CI does not have yet when this suite
// runs (the web bundle is built later in the workflow), so before() assembles a
// synthetic one and after() takes it back down, restoring rather than deleting
// anything that was already there.
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
const faviconPath = path.join(distDir, "favicon.ico");
const assetDir = path.join(distDir, "_expo", "static", "js", "web");
const assetPath = path.join(
  assetDir,
  "app-fixture.deadbeefcafebabe0123456789abcdef.js"
);

// Large enough to clear compression's default 1 KB threshold, so the
// compression assertions and the caching assertions can share one fixture.
const FIXTURE_INDEX_HTML = `<!doctype html><div id="root"></div><!-- ${"x".repeat(2000)} -->`;
const FIXTURE_JS = `// synthetic content-hashed asset\n${"x".repeat(4000)}`;
// Only its URL matters here, not its bytes — the browser fetches /favicon.ico
// on every visit and the header it comes back with is the whole point.
const FIXTURE_FAVICON = Buffer.from("00000100", "hex");

describe("static asset compression and caching", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const createdDirs: string[] = [];
  let restoreIndex: (() => void) | null = null;
  let removeFavicon: (() => void) | null = null;

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

    if (!fs.existsSync(faviconPath)) {
      fs.writeFileSync(faviconPath, FIXTURE_FAVICON);
      removeFavicon = () => fs.rmSync(faviconPath, { force: true });
    }

    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(assetPath, { force: true });
    restoreIndex?.();
    removeFavicon?.();
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
