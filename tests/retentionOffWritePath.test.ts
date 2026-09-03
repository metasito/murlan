// tests/retentionOffWritePath.test.ts — #895: retention is server/retention.ts's
// scheduled job, not a DELETE riding the same write that just grew the table.
//
// events.ts, clientErrors.ts, replays.ts, authTokens.ts and bugReports.ts each
// used to prune their own table on the write path — a seq scan for events and
// auth_tokens, a pointless one for the others (already indexed) — and each
// one's comment cited a sibling as precedent for the shape. This pins the
// class shut across every module under server/, not just the five that were
// caught: an age-based (`make_interval`) delete may not share a function body
// with an insert.
//
// Scoped to the age-based signature deliberately, not to "insert and delete
// anywhere in one file": server/push.ts and server/stats.ts also combine the
// two, to cap rows kept per user (`notInArray` against a `keep` set) — a
// different, legitimate shape this ticket does not touch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");

function serverSources(): { file: string; source: string }[] {
  return readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((file) => ({ file, source: readFileSync(path.join(SERVER_DIR, file), "utf8") }));
}

test("no server module prunes an aged row inside the write that just grew the table", () => {
  const offenders = serverSources()
    .filter(
      ({ source }) =>
        /\.insert\(/.test(source) && /\.delete\(/.test(source) && /make_interval\(\s*days\s*=>/.test(source)
    )
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    "an age-based prune belongs to server/retention.ts's scheduled sweep, " +
      "not the write path — this shape once justified itself in " +
      "server/events.ts, server/clientErrors.ts, server/replays.ts and " +
      "server/bugReports.ts by citing each other as precedent. Offending " +
      "module(s): " +
      offenders.join(", ")
  );
});
