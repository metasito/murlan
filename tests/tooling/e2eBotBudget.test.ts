import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const bot = readFileSync(path.resolve(import.meta.dirname, "..", "e2e", "helpers", "bot.ts"), "utf8");

test("every read of GIOCA's label waits the helper's own click budget, never a literal of its own", () => {
  const reads = [...bot.matchAll(/giocaAccepts\(([^)]*)\)/g)].filter((m) => !m[0].includes("function"));
  assert.ok(reads.length >= 2, "the scan finds the reads it guards");
  assert.deepEqual(
    reads.map((m) => m[1]).filter((args) => /\d/.test(args)),
    [],
    "a fixed wait on GIOCA runs out on a throttled table and reports an unplayable hand"
  );
});
