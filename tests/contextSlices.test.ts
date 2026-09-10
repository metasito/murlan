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

/** Every context hook a slice module can legitimately read. */
const CONTEXT_HOOKS = /use(?:Online)?Game|use(?:Connection|Room|Table|TurnClock|Match|Exchange)Slice/
  .source;

/**
 * The names a slice hook destructures off `via`, its own context hook.
 *
 * Every destructure in the body, not the first: a hook that reads its context
 * twice widens by whatever the second one takes, and reading only the first
 * would leave that invisible to the very check meant to catch it. A second
 * call is rejected outright as well, since it is also how a field ends up in
 * two slices without the partition below noticing, and how an online slice
 * comes to wake on a second slice's fields.
 */
function sliceRead(source: string, hookName: string): { via: string; fields: string[] } {
  const start = source.indexOf(`export function ${hookName}(`);
  assert.notEqual(start, -1, `no hook ${hookName}`);
  const body = source.slice(start, source.indexOf("\n}", start));

  const calls = [...body.matchAll(new RegExp(`(${CONTEXT_HOOKS})\\s*\\(`, "g"))].map((m) => m[1]);
  assert.equal(
    calls.length,
    1,
    `${hookName} reads ${calls.join(", ") || "no context"}; a slice reads one, once`
  );
  const via = calls[0];

  const fields = [...body.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*\\n?\\s*${via}\\(\\)`, "g"))]
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(fields.length, `${hookName} does not read ${via} by destructuring`);
  return { via, fields };
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
  useOnlineTable: ["gameState", "mySeatIndex", "playCards", "pass", "sendReaction", "disconnectedSeats"],
  useOnlineTurnClock: ["turnSeconds", "turnDeadlineMs"],
  useOnlineMatch: [
    "matchState", "cumulativeScores", "handScores", "ratingDeltas", "handRecorded",
    "rematchVoteState", "endMatchVoteState", "rematchIntents", "rematchPromptOpen",
    "voteRematch", "voteToEndMatch", "answerRematch",
  ],
  useOnlineExchange: [
    "exchangeAnnouncing", "exchangeAnnounceData", "giveExchangeCard", "acknowledgeExchange",
  ],
};

/**
 * The context each slice reads. Six of them online, one each, which is what
 * keeps a turn-deadline change off the five slices it says nothing about; the
 * local game has one small context and no such cost.
 */
const VIA: Record<string, string> = {
  useOnlineConnection: "useConnectionSlice",
  useOnlineRoom: "useRoomSlice",
  useOnlineTable: "useTableSlice",
  useOnlineTurnClock: "useTurnClockSlice",
  useOnlineMatch: "useMatchSlice",
  useOnlineExchange: "useExchangeSlice",
  useLocalTable: "useGame",
  useLocalSession: "useGame",
  useLocalMatch: "useGame",
  useLocalExchange: "useGame",
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
    "exchangeAnnouncing", "exchangeAnnounceData", "exchangeHoldMsOverride", "chooseExchangeCard",
    "acknowledgeExchange", "releaseStuckExchange",
  ],
};

for (const [file, expected] of [
  ["context/onlineGameHooks.ts", ONLINE],
  ["context/gameHooks.ts", LOCAL],
] as const) {
  test(`${file}: each slice reads exactly its own concern`, () => {
    const source = read(file);
    for (const [hook, fields] of Object.entries(expected)) {
      const slice = sliceRead(source, hook);
      assert.equal(slice.via, VIA[hook], `${hook} reads ${slice.via}, not its own context`);
      assert.deepEqual(
        slice.fields.sort(),
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

test("each online slice reads one context, and no two read the same one", () => {
  // The saving is the split, and two slices sharing a context is how it is
  // half-made: every shape check above still passes while a turn-deadline
  // change wakes both. `sliceFields` pins the one; this pins the six.
  const source = read("context/onlineGameHooks.ts");
  const contexts = Object.keys(ONLINE).map((hook) => sliceRead(source, hook).via);
  assert.equal(new Set(contexts).size, contexts.length, "two online slices share a context");

  const provider = read("context/OnlineGameContext.tsx");
  for (const via of contexts) {
    assert.match(
      provider,
      new RegExp(`\\[\\s*\\w+\\s*,\\s*${via}\\s*\\]\\s*=\\s*sliceContext<`),
      `${via} is not a context of its own`
    );
  }
});

test("nothing reaches past the slices for the whole surface", () => {
  // The slices are only worth having if they are the way in. Every context
  // hook stays exported because the slices are built on them, and each is also
  // a way back past a slice — `useOnlineGame` to the thirty-seven-field
  // destructure, a `use*Slice` to a context a screen has no business naming.
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
      if (new RegExp(`\\b(${CONTEXT_HOOKS})\\s*\\(`).test(code)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a screen calls a context hook directly instead of the slice for its concern"
  );
});
