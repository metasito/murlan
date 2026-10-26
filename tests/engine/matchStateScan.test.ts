// tests/engine/matchStateScan.test.ts — the source scans split out of matchState.test.ts so the mutation run keeps that file's behaviour tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// `lib/game/autoMove.ts` was written to be the one bot rule and landed with only
// the server calling it, so the offline copy stayed live behind a green
// extraction: every check passed, because each mode's tests exercised its own
// implementation. Counting the callers of the engine's move chooser is the
// fact that distinguishes one implementation from two — a second one has to
// call it, whatever else it does.
test("one module chooses a bot's move", () => {
  const HOME = "lib/game/autoMove.ts";
  // The suites that pin the bot's own choices; test support drives a seat through HOME like any table.
  const PINS_THE_BOT = ["tests/bots/", "tests/engine/"];
  const sources = [
    ...appSources(),
    ...sourcesUnder(repoRoot, ["tests"]).filter(([rel]) => !PINS_THE_BOT.some((dir) => rel.startsWith(dir))),
  ].map(([rel, text]): [string, string] => [rel, blankCommentsAndStrings(text)]);
  for (const chooser of ["botChoosePlay", "pickGivebackCard"]) {
    const callers = sources
      .filter(([, code]) => new RegExp(String.raw`(?<!function )\b${chooser}\s*\(`).test(code))
      .map(([rel]) => rel);

    assert.deepEqual(
      callers,
      [HOME],
      `${chooser} is how a seat's move is chosen, so a second caller is a second ` +
        `bot. Route it through ${HOME} instead: ${callers.join(", ")}`
    );
  }
});

test("the offline table and its harness both take a bot's turn from offlineBotMove", () => {
  const calls = (rel: string, fn: string) =>
    new RegExp(String.raw`\b${fn}\s*\(`).test(blankCommentsAndStrings(readFileSync(path.join(repoRoot, rel), "utf8")));
  const callers = ["context/GameContext.tsx", "tests/helpers/offlineMatch.ts"];

  assert.deepEqual(callers.filter((rel) => !calls(rel, "offlineBotMove")), [], "must call offlineBotMove");
  assert.ok(
    !calls("context/GameContext.tsx", "autoMoveForSeat"),
    "GameContext.tsx choosing a move itself is a second offline bot the harness never plays"
  );
});

test("only lib/game/autoMove.ts reaches the bot heuristics in lib/game/bot.ts", () => {
  const importers = appSources()
    .filter(([, text]) => /from\s+["'](?:\.\/|@\/lib\/game\/|[./]+\/lib\/game\/)bot(?:\.ts)?["']/.test(blankComments(text)))
    .map(([rel]) => rel);

  assert.deepEqual(importers, ["lib/game/autoMove.ts"]);
});

test("gameEngine.ts exports no bot heuristic", async () => {
  const engine = await import("../../lib/game/gameEngine.ts");
  const ai = await import("../../lib/game/bot.ts");
  const engineSource = readFileSync(path.join(repoRoot, "lib/game/gameEngine.ts"), "utf8");

  assert.ok(Object.keys(ai).length > 0);
  assert.deepEqual(Object.keys(ai).filter((name) => name in engine), []);
  assert.doesNotMatch(engineSource, /^import\s+\{[^}]*\bgetBotPersonality\b/m);
});

function appSources(): [string, string][] {
  return sourcesUnder(repoRoot, ["app", "components", "context", "lib", "server"]);
}
