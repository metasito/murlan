// tests/bots/botPersonalitiesScan.test.ts — the source scan split out of botPersonalities.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// applyPersonality's unpredictability knob indexes a filtered slice of `plays`,
// so that array's order decides which alt it lands on. Every tier has to hand it
// getAllValidPlays' own order, or one personality and one rng sequence answer
// differently depending on which difficulty tier ran.
test("botChoosePlay never sorts the array getAllValidPlays returned in place", () => {
  const src = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/game/bot.ts"),
    "utf8"
  );
  const start = src.indexOf("export function botChoosePlay");
  const end = src.indexOf("\n}\n", start);
  assert.ok(start > 0 && end > start, "could not locate botChoosePlay's body to scan");
  assert.doesNotMatch(src.slice(start, end), /\bplays\.sort\(/);
});
