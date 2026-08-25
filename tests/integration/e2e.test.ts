// tests/integration/e2e.test.ts — the SPA fallback from a real checkout path.
//
// `res.sendFile` in the catch-all route (server/app.ts) used to take an
// absolute path with no `root` option. Express's `send` module then applies
// its dotfile policy to *every segment of the filesystem path*, not just the
// request path — so a checkout living under a dot-prefixed directory (this
// repo's own agent worktrees, parked under `.claude/worktrees/…`) got a raw
// JSON 404 for every client-side route instead of the app shell. See #274.
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

// Mirrors httpCaching.test.ts: a synthetic dist/ tree of this suite's own,
// with cwd moved onto it for the life of the server so it never collides
// with another integration suite's dist/ under the real process.cwd().
const FIXTURE_INDEX_HTML = `<!doctype html><html><body><div id="root">murlan-app-shell-e2e274</div></body></html>`;

describe("the SPA fallback from a dot-prefixed checkout", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let originalCwd: string;
  let sandbox: string;
  let workDir: string;

  before(async () => {
    // Inside before(), not at module scope: a skipped describe still
    // evaluates the module, and after() — which is what removes this —
    // does not run.
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-e2e-"));
    // The reproduction from #274: a worktree parked under a dot directory.
    workDir = path.join(sandbox, ".claude", "worktrees", "agent-274");
    const distDir = path.join(workDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), FIXTURE_INDEX_HTML);

    originalCwd = process.cwd();
    process.chdir(workDir);
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

  test("an arbitrary client-side route gets the app shell, not a 404", async () => {
    const res = await fetch(`${server.url}/lobby/table/42`);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(body, FIXTURE_INDEX_HTML);
  });

  test("an unmatched API route is not answered with the app shell", async () => {
    const res = await fetch(`${server.url}/api/does-not-exist`);
    const body = await res.text();
    assert.equal(res.status, 404, body);
    assert.doesNotMatch(
      body,
      /murlan-app-shell-e2e274/,
      "an unmatched /api route must never fall through to the SPA shell"
    );
  });
});
