// tests/contextSlices.test.ts — the slices stay narrow, and stay a partition.
//
// The point of the split is that a screen reads one concern and a screen test
// declares one concern. Nothing stops a later change from reaching for a
// seventh field in a hook that had five, and the cost of that shows up as a
// slowly re-widening mock rather than as a failure — which is how the
// thirty-seven-field surface was arrived at in the first place.
//
// Source-read rather than rendered: these are projections with no behaviour of
// their own to exercise, and what is being pinned is the shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fieldsOf, walk } from "../scripts/contextSurface.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

/** The names a slice hook destructures off its context hook. */
function sliceFields(source: string, hookName: string): string[] {
  const start = source.indexOf(`export function ${hookName}(`);
  assert.notEqual(start, -1, `no hook ${hookName}`);
  const body = source.slice(start, source.indexOf("\n}", start));
  const m = body.match(/const\s*\{([^}]*)\}\s*=\s*\n?\s*use(?:Online)?Game\(\)/);
  assert.ok(m, `${hookName} does not read its context hook by destructuring`);
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ONLINE: Record<string, string[]> = {
  useOnlineConnection: [
    "connected", "error", "reconnectNotice", "playerLeft", "rejoinFailed",
    "clearError", "clearPlayerLeft", "clearRejoinFailed",
  ],
  useOnlineRoom: [
    "room", "entrySource", "isSpectator", "createRoom", "joinRoom",
    "spectateRoom", "leaveRoom", "quickmatch", "startGame",
  ],
  useOnlineTable: ["gameState", "mySeatIndex", "playCards", "pass", "sendReaction"],
  useOnlineTurnClock: ["turnSeconds", "turnDeadlineMs"],
  useOnlineMatch: [
    "matchState", "cumulativeScores", "handScores", "ratingDeltas", "rematchVoteState",
    "rematchIntents", "rematchPromptOpen", "voteRematch", "answerRematch",
  ],
  useOnlineExchange: [
    "exchangeAnnouncing", "exchangeAnnounceData", "giveExchangeCard", "acknowledgeExchange",
  ],
};

const LOCAL: Record<string, string[]> = {
  useLocalTable: [
    "gameState", "selectedCards", "selectCard", "playSelected", "passTurn", "runAITurn",
  ],
  useLocalSession: ["setupGame", "resetGame", "hasSavedGame", "resumeGame"],
  useLocalMatch: [
    "match", "rematchAnswers", "rematchTally", "tableWantsRematch",
    "rematchPromptOpen", "answerRematch", "startNextHand", "startNewMatch",
  ],
  useLocalExchange: [
    "exchangeAnnouncing", "exchangeAnnounceData", "chooseExchangeCard", "acknowledgeExchange",
  ],
};

for (const [file, expected] of [
  ["context/onlineGameHooks.ts", ONLINE],
  ["context/gameHooks.ts", LOCAL],
] as const) {
  test(`${file}: each slice reads exactly its own concern`, () => {
    const source = read(file);
    for (const [hook, fields] of Object.entries(expected)) {
      assert.deepEqual(
        sliceFields(source, hook).sort(),
        [...fields].sort(),
        `${hook} reads a different set than its concern`
      );
    }
  });
}

test("the slices partition the context, leaving nothing unreachable", () => {
  for (const [contextFile, iface, slices] of [
    ["context/OnlineGameContext.tsx", "OnlineGameContextValue", ONLINE],
    ["context/GameContext.tsx", "GameContextValue", LOCAL],
  ] as const) {
    const all = fieldsOf(read(contextFile), iface) as string[];
    const covered = new Set(Object.values(slices).flat());
    // A field no slice offers is reachable only through the wide hook, which
    // is the thing being retired. A field in two slices is a concern boundary
    // drawn in the wrong place.
    assert.deepEqual(
      all.filter((f) => !covered.has(f)),
      [],
      `${iface} has fields no slice exposes`
    );
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const f of Object.values(slices).flat()) {
      if (seen.has(f)) twice.push(f);
      seen.add(f);
    }
    assert.deepEqual(twice, [], `${iface} has fields in more than one slice`);
  }
});

test("nothing reaches past the slices for the whole surface", () => {
  // The slices are only worth having if they are the way in. `useOnlineGame`
  // and `useGame` stay exported because the slices are built on them, and that
  // export is also the way back to a thirty-seven-field destructure.
  const offenders: string[] = [];
  for (const file of walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "components")))) {
    const src = readFileSync(file, "utf8");
    if (/\buseOnlineGame\s*\(|\buseGame\s*\(/.test(src)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a screen calls a context hook directly instead of the slice for its concern"
  );
});
