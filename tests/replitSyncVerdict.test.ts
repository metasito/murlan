import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verdict } from "../scripts/replitSyncVerdict.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(repoRoot, "scripts", "replitSyncVerdict.mjs");

// Run 33809403903 (#905) recorded a 404 whose body was Replit's
// stopped-workspace page (`<title>Run this app to see the results here.</title>`)
// and whose curl exit code was non-zero — `verdict` reads neither the body nor
// (for this case) the exit code, only the status below, which is the whole fix.

describe("verdict decides from the HTTP response, never a pipeline's exit status", () => {
  test("a 404 is a stopped workspace, even though curl reported a response", () => {
    // The workflow calls curl without --fail, so status is 0 for any completed
    // HTTP transaction, error statuses included — this is exactly the case run
    // 33809403903 hit, and status alone must not decide "ok".
    assert.equal(verdict({ code: "404", status: 0 }), "stopped");
  });

  test("a 200 with curl reporting success is ok", () => {
    assert.equal(verdict({ code: "200", status: 0 }), "ok");
  });

  test("a 502 is a failure, not a stopped workspace", () => {
    assert.equal(verdict({ code: "502", status: 0 }), "failed");
  });

  test("a transport failure with no HTTP response at all is a failure", () => {
    // curl's --write-out prints "000" when it never got a response.
    assert.equal(verdict({ code: "000", status: 7 }), "failed");
  });

  test("a missing code is read the same as no response, not as stopped", () => {
    assert.equal(verdict({ status: 7 }), "failed");
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
