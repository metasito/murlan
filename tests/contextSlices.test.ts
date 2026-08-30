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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fieldsOf, walk } from "../scripts/contextSurface.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

/**
 * The names a slice hook destructures off its context hook.
 *
 * Every destructure in the body, not the first: a hook that reads its context
 * twice widens by whatever the second one takes, and reading only the first
 * would leave that invisible to the very check meant to catch it. A second
 * call is rejected outright as well, since it is also how a field ends up in
 * two slices without the partition below noticing.
 */
function sliceFields(source: string, hookName: string): string[] {
  const start = source.indexOf(`export function ${hookName}(`);
  assert.notEqual(start, -1, `no hook ${hookName}`);
  const body = source.slice(start, source.indexOf("\n}", start));

  const calls = [...body.matchAll(/use(?:Online)?Game\s*\(/g)];
  assert.equal(
    calls.length,
    1,
    `${hookName} reads its context ${calls.length} times; a slice reads it once`
  );

  const names = [...body.matchAll(/const\s*\{([^}]*)\}\s*=\s*\n?\s*use(?:Online)?Game\(\)/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(names.length, `${hookName} does not read its context hook by destructuring`);
  return names;
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
  // Every source directory, not the two that happen to hold consumers today:
  // a screen moved into a new one would leave the guard behind. The slice
  // modules are the exception, being what the hooks are for; the providers
  // define them.
  const ALLOWED = /[\\/]context[\\/](onlineGameHooks|gameHooks|OnlineGameContext|GameContext)\.tsx?$/;
  const offenders: string[] = [];
  for (const dir of ["app", "components", "context", "lib", "hooks"]) {
    const full = path.join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      if (ALLOWED.test(file)) continue;
      // Comments mention these hooks by name legitimately; code calls them.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/\buseOnlineGame\s*\(|\buseGame\s*\(/.test(code)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a screen calls a context hook directly instead of the slice for its concern"
  );
});
