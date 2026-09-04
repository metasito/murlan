import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verdict } from "../scripts/replitSyncVerdict.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(repoRoot, "scripts", "replitSyncVerdict.mjs");

// Recorded from run 33809403903 (#905): the page Replit's edge serves for a
// workspace that is not running, under a 404.
const STOPPED_WORKSPACE_BODY =
  "<!doctype html><html><head><title>Run this app to see the results here.</title></head>" +
  "<body><h1>Run this app to see the results here.</h1></body></html>";

// A recorded Replit edge error for a workspace that is running but not
// answering — the "real failure" case, not "stopped".
const BAD_GATEWAY_BODY = "<html><body><h1>502 Bad Gateway</h1></body></html>";

describe("verdict decides from the HTTP response, never a pipeline's exit status", () => {
  test("a 404 is a stopped workspace, even though curl reported a response", () => {
    // The workflow calls curl without --fail, so status is 0 for any completed
    // HTTP transaction, error statuses included — this is exactly the case run
    // 33809403903 hit, and status alone must not decide "ok".
    assert.equal(verdict({ code: "404", status: 0, body: STOPPED_WORKSPACE_BODY }), "stopped");
  });

  test("a 200 with curl reporting success is ok", () => {
    assert.equal(verdict({ code: "200", status: 0, body: "" }), "ok");
  });

  test("a 502 is a failure, not a stopped workspace", () => {
    assert.equal(verdict({ code: "502", status: 0, body: BAD_GATEWAY_BODY }), "failed");
  });

  test("a transport failure with no HTTP response at all is a failure", () => {
    // curl's --write-out prints "000" when it never got a response.
    assert.equal(verdict({ code: "000", status: 7, body: "" }), "failed");
  });

  test("a missing code is read the same as no response, not as stopped", () => {
    assert.equal(verdict({ status: 7, body: "" }), "failed");
  });
});

describe("the CLI entry point the workflow actually calls", () => {
  const run = (code: string, status: string) =>
    execFileSync("node", [SCRIPT, code, status], { encoding: "utf8" });

  test("prints the verdict to stdout with no trailing newline", () => {
    assert.equal(run("404", "0"), "stopped");
    assert.equal(run("200", "0"), "ok");
    assert.equal(run("502", "0"), "failed");
  });
});
