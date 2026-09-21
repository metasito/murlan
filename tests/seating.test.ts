import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings, sourcesUnder } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a socket takes a seat only through seatSocket", () => {
  const writers = sourcesUnder(repoRoot, ["server"])
    .filter(([, src]) => /\bsocketRoomMap\.set\(/.test(blankCommentsAndStrings(src)))
    .map(([file]) => file);
  assert.deepEqual(writers, ["server/seating.ts"]);
});
