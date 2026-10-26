// tests/bots/botFillScan.test.ts — the source scan split out of botFill.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// seatAssignmentsFromRoster landed with one caller (newTable) and an
// unused-import lint warning is not the same guarantee: `void
// seatAssignmentsFromRoster;` silences the warning without calling it, so a
// second, inline rebuild of the same maps leaves tsc, lint and every other
// test green. Counting call sites — `name(`, not merely `name` — is the fact
// that tells the two apart.
test("one function builds a match's playerMap and botSeatsAtStart", () => {
  const TARGET = "seatAssignmentsFromRoster";
  const HOME = "server/game/onlineGameLogic.ts";
  const callers = sourcesUnder(repoRoot, ["app", "components", "context", "lib", "server"])
    .filter(([, text]) => new RegExp(String.raw`\b${TARGET}\s*\(`).test(blankCommentsAndStrings(text)))
    .map(([rel]) => rel);

  assert.deepEqual(
    callers.sort(),
    [HOME, "server/game/tableState.ts"].sort(),
    `${TARGET} is how a match's roster becomes playerMap and botSeatsAtStart, ` +
      `so a caller that stops calling it, or a second inline copy, shows up ` +
      `here: ${callers.join(", ")}`
  );
});

