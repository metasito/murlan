// tests/ui-rules/intentsGoThroughSend.test.ts — the client has one way to talk to the server.
//
// A bare `emit` is at-most-once and carries no intentId, so its loss is silent
// and its retry is a second intent. `send()` in `lib/sendIntent.ts` is the path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const SERVER_SIDE = /^(server|tests|scripts|tools)\//;
const BARE_EMIT = /\.emit\(\s*["'`](room|game):/;

const clientSources = execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx"], { cwd: repoRoot, encoding: "utf8" })
  .split("\0")
  .filter((file) => file && !SERVER_SIDE.test(file));

test("the scan reads the client, including the one module allowed to emit", () => {
  assert.ok(clientSources.includes("context/OnlineGameContext.tsx"));
  assert.ok(clientSources.includes("lib/sendIntent.ts"));
  assert.ok(BARE_EMIT.test(`socket?.emit("room:leave")`));
});

test("no client module emits a room: or game: event except through send()", () => {
  const offenders = clientSources
    .filter((file) => file !== "lib/sendIntent.ts")
    .flatMap((file) =>
      readFileSync(path.join(repoRoot, file), "utf8")
        .split("\n")
        .flatMap((line, i) => (BARE_EMIT.test(line) ? [`${file}:${i + 1}`] : []))
    );
  assert.deepEqual(offenders, []);
});
