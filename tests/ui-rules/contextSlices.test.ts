// tests/ui-rules/contextSlices.test.ts — the slices stay narrow, and stay a partition.
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
import { fieldsOf, walk } from "../../scripts/contextSurface.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

/** The wide hooks: whatever reads one wakes on every field of its context. */
const CONTEXT_HOOKS = /use(?:Online)?Game/.source;

/**
 * The context hook a slice reads, and the names it destructures off it, both
 * read from the source. The distinctness check below counts what this returns
 * rather than what `VIA` says: a set built from the expectation is distinct by
 * construction and would pin nothing.
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
  assert.ok(fields.length, `${hookName} does not read ${via}() by destructuring`);
  return { via, fields };
}

/**
 * Each online slice as the provider makes it: `[Context, useHook] = sliceContext<Type>("useHook")`,
 * read off the source, with the fields the `Pick` that is its type names.
 */
function onlineSlices(): { hook: string; context: string; fields: string[] }[] {
  const provider = read("context/OnlineGameContext.tsx");
  return [...provider.matchAll(/\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*sliceContext<(\w+)>\("(\w+)"\)/g)].map(
    ([, context, hook, type, named]) => {
      assert.equal(named, hook, `${hook} reports itself as ${named}`);
      const pick = provider.match(new RegExp(`type ${type} = Pick<\\s*OnlineGameContextValue,([^>]*)>`))?.[1];
      assert.ok(pick, `${type} is not a Pick of OnlineGameContextValue`);
      return { hook, context, fields: [...pick.matchAll(/"(\w+)"/g)].map((m) => m[1]) };
    }
  );
}

const ONLINE: Record<string, string[]> = {
  useOnlineConnection: [
    "connected", "error", "reconnectNotice", "playerLeft", "rejoinFailed",
    "clearError", "clearPlayerLeft", "clearRejoinFailed", "retryConnection", "ownLink", "pill",
  ],
  useOnlineRoom: [
    "room", "entrySource", "isSpectator", "createRoom", "joinRoom",
    "spectateRoom", "leaveRoom", "quickmatch", "setRoomVisibility", "startGame",
  ],
  useOnlineTable: ["gameState", "mySeatIndex", "playCards", "pass", "sendReaction", "disconnectedSeats", "autoPassed"],
  useOnlineTurnClock: ["turnSeconds", "turnDeadlineMs"],
  useOnlineMatch: [
    "matchState", "cumulativeScores", "placementPoints", "placementPointsCurrent", "ratingDeltas", "roundRecorded", "ratingsAfter",
    "rematchVoteState", "endMatchVoteState", "voteRematch", "voteToEndMatch",
  ],
  useOnlineExchange: [
    "exchangeAnnouncing", "exchangeAnnounceData", "giveExchangeCard", "acknowledgeExchange",
  ],
};

/** The context each local slice reads: one small one, with no turn clock to keep off the rest. */
const VIA: Record<string, string> = {
  useLocalTable: "useGame",
  useLocalSession: "useGame",
  useLocalMatch: "useGame",
  useLocalExchange: "useGame",
};

const LOCAL: Record<string, string[]> = {
  useLocalTable: ["gameState", "playCards", "passTurn", "runBotTurn"],
  useLocalSession: ["setupGame", "resetGame", "hasSavedGame", "resumeGame", "restored"],
  useLocalMatch: ["match", "startNextRound", "startNewMatch"],
  useLocalExchange: [
    "exchangeAnnouncing", "exchangeAnnounceData", "exchangeHoldMsOverride", "chooseExchangeCard",
    "acknowledgeExchange", "releaseStuckExchange",
  ],
};

test("context/OnlineGameContext.tsx: each slice is exactly its own concern", () => {
  // The hooks come from the source too. A seventh slice named only in the
  // provider is one this test would otherwise never read.
  const slices = onlineSlices();
  assert.deepEqual(
    slices.map((s) => s.hook).sort(),
    Object.keys(ONLINE).sort(),
    "the provider makes slices this test does not check"
  );
  for (const { hook, fields } of slices) {
    assert.deepEqual([...fields].sort(), [...(ONLINE[hook] ?? [])].sort(), `${hook} holds a different set than its concern`);
  }
});

test("context/onlineGameHooks.ts re-exports every online slice, and is nothing but that", () => {
  const source = read("context/onlineGameHooks.ts").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const reexport = source.match(/^export\s*\{([^}]*)\}\s*from\s*"\.\/OnlineGameContext";\s*$/);
  assert.ok(reexport, "onlineGameHooks.ts is a re-export of the provider's hooks and holds no code of its own");
  const names = reexport[1].split(",").map((n) => n.trim()).filter(Boolean);
  assert.deepEqual(
    names.filter((n) => n !== "useServerError").sort(),
    Object.keys(ONLINE).sort(),
    "onlineGameHooks.ts re-exports a different set of slices"
  );
});

test("context/gameHooks.ts: each slice reads exactly its own concern", () => {
  const source = read("context/gameHooks.ts");
  assert.deepEqual(
    [...source.matchAll(/export function (use\w+)\(/g)].map((m) => m[1]).sort(),
    Object.keys(LOCAL).sort(),
    "context/gameHooks.ts exports slices this test does not check"
  );
  for (const [hook, fields] of Object.entries(LOCAL)) {
    const slice = sliceRead(source, hook);
    assert.equal(slice.via, VIA[hook], `${hook} reads ${slice.via}, not its own context`);
    assert.deepEqual(slice.fields.sort(), [...fields].sort(), `${hook} reads a different set than its concern`);
  }
});

test("the slices partition the context, leaving nothing unreachable", () => {
  for (const [contextFile, iface, slices] of [
    ["context/OnlineGameContext.tsx", "OnlineGameContextValue", ONLINE],
    ["context/GameContext.tsx", "GameContextValue", LOCAL],
  ] as const) {
    const all = fieldsOf(read(contextFile), iface) as string[];
    const covered = new Set(Object.values(slices).flat());
    // A field no slice offers is reachable only through the wide hook, which
    // no screen may call. A field in two slices is a concern boundary drawn in
    // the wrong place.
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
  // change wakes both.
  const contexts = onlineSlices().map((s) => s.context);
  assert.equal(new Set(contexts).size, contexts.length, "two online slices share a context");
  const provider = read("context/OnlineGameContext.tsx");
  for (const context of contexts) {
    assert.match(provider, new RegExp(`<${context}\\.Provider value=\\{\\w+\\}>`), `${context} is never provided`);
  }
});

test("nothing reaches past the slices for the whole surface", () => {
  // The slices are only worth having if they are the way in. Every context
  // hook stays exported because the slices are built on them, and each is also
  // a way back past a slice — `useGame` to the whole local context.
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

test("no wide online hook is left in context/ for a screen to reach for", () => {
  for (const file of walk(path.join(ROOT, "context"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /function useOnlineGame\b/, `${path.relative(ROOT, file)} defines useOnlineGame`);
  }
});
