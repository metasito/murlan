// A test that stages a shutdown ends it: the flag is process-wide, so a leftover one refuses every server the next test boots.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("every test file that calls beginShutdown() also calls __resetShutdown(), or stops a test server that does", () => {
  const files = sourcesUnder(repoRoot, ["tests"]).filter(([file]) => file !== "tests/server/shutdownReset.test.ts");
  const staging = files.filter(([, src]) => /\bbeginShutdown\(\)/.test(src));
  assert.ok(staging.length >= 4, "the scan must see the files that stage a shutdown, or it proves nothing");
  const leaking = staging.filter(([, src]) => !/\b__resetShutdown\b|\bstartTestServer\(/.test(src)).map(([file]) => file);
  assert.deepEqual(leaking, []);
});
