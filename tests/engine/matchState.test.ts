// tests/engine/matchState.test.ts — the seat a finished round or match celebrates.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { celebratesViewer, isDrawnRound, roundOutcomeFor, matchOutcomeFor, scoredOutcome } from "../../lib/game/matchState.ts";
import { autoMoveForSeat, offlineBotMove } from "../../lib/game/autoMove.ts";
import { emptyRankTally, type Card, type GameState, type PlayerType } from "../../lib/game/gameEngine.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TABLE = [
  { id: "player_0", name: "Alice", team: "A" },
  { id: "player_1", name: "Bob", team: "B" },
  { id: "player_2", name: "Carl", team: "A" },
];

describe("celebratesViewer", () => {
  test("reads the first candidate that names a seat", () => {
    assert.equal(celebratesViewer(TABLE, ["player_1", "player_0"], "player_1", false), true);
    assert.equal(celebratesViewer(TABLE, ["player_1", "player_0"], "player_0", false), false);
  });

  // A client that rejoins a table which finished while it was away never
  // receives `game:round_over`, so it holds `over: true` with no winners at all.
  test("passes over an undefined candidate", () => {
    assert.equal(celebratesViewer(TABLE, [undefined, "player_2"], "player_2", false), true);
  });

  // The winner id outliving the seat it named is the same shape as the hole
  // above, and the one a `find(c => c !== undefined)` would swallow: the
  // candidate is present, so the fallback behind it never gets its turn.
  test("passes over a candidate that names no seat", () => {
    assert.equal(celebratesViewer(TABLE, ["player_9", "player_0"], "player_0", false), true);
  });

  test("celebrates the winner's teammate in team mode only", () => {
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_2", true), true);
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_2", false), false);
    assert.equal(celebratesViewer(TABLE, ["player_0"], "player_1", true), false);
  });

  test("celebrates nobody when no candidate names a seat, or the viewer holds none", () => {
    assert.equal(celebratesViewer(TABLE, [undefined, "player_9"], "player_0", false), false);
    assert.equal(celebratesViewer(TABLE, ["player_0"], undefined, false), false);
  });
});

// GAME-RULES.md §11: first-and-fourth (3+0) pays the same total as second-and-
// third (2+1), so a round can end with both teams tied.
describe("isDrawnRound", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("first-and-fourth against second-and-third is a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), true);
  });

  test("a team that placed both members ahead is not a draw", () => {
    const placementPoints = { player_0: 3, player_1: 1, player_2: 0, player_3: 2 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), false);
  });

  test("a table with no team assignment is never a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(
      isDrawnRound(
        TEAMS_TABLE.map(({ id }) => ({ id })),
        placementPoints
      ),
      false
    );
  });

  // Online, a round's finishingOrder reach the client before its scores do — an
  // empty or partial score set totals every team to zero, which is not the
  // same fact as every team scoring the same. "Not known yet" must read as
  // not-a-draw, or a round whose scores just haven't arrived reports the same
  // answer as one that genuinely tied.
  test("an absent score set is not a draw", () => {
    assert.equal(isDrawnRound(TEAMS_TABLE, {}), false);
  });

  test("a partial score set — some seats not scored yet — is not a draw", () => {
    const placementPoints = { player_0: 3, player_1: 2 };
    assert.equal(isDrawnRound(TEAMS_TABLE, placementPoints), false);
  });
});

describe("roundOutcomeFor", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];
  // First-and-fourth (3+0) against second-and-third (2+1): a draw.
  const drawnFinishingOrder = ["player_0", "player_1", "player_2", "player_3"];
  const drawnScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };

  test("is a draw for every seat on a drawn teams round", () => {
    for (const { id } of TEAMS_TABLE) {
      assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, id, true), "draw");
    }
  });

  test("is won for the team that placed first-and-third, not just the seat that placed first", () => {
    const finishingOrder = ["player_0", "player_1", "player_3", "player_2"];
    const scores = { player_0: 3, player_1: 2, player_3: 1, player_2: 0 };
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_0", true), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_3", true), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_1", true), "lost");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_2", true), "lost");
  });

  test("in free-for-all, only the seat that placed first or last gets an outcome", () => {
    const finishingOrder = ["player_2", "player_0", "player_1", "player_3"];
    const scores = { player_2: 3, player_0: 2, player_1: 1, player_3: 0 };
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_2", false), "won");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_3", false), "lost");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_0", false), "neutral");
    assert.equal(roundOutcomeFor(TEAMS_TABLE, finishingOrder, scores, "player_1", false), "neutral");
  });

  test("is neutral for a spectator holding no seat", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, undefined, true), "neutral");
  });

  test("is neutral before any round has a finish order", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, [], {}, "player_0", true), "neutral");
  });

  // `isTeamMode` is what gates the draw suppression on a table that merely
  // carries `.team` fields — free-for-all seats never do, which is what made
  // this guard look removable without reddening anything: nothing exercised
  // a non-teams table where `.team` happened to be set anyway.
  test("the isTeamMode guard actually gates the draw check", () => {
    assert.equal(
      roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, drawnScores, "player_0", false),
      "won"
    );
  });

  // Online, `finishingOrder` reaches the client (`game:state`, roundOver: true) a
  // render ahead of `placementPoints` (the separate `game:round_over`) — the caller
  // (components/useTableFeedback.ts) has to be able to tell "not decided
  // yet" apart from "draw" so it knows to wait for the
  // render the scores arrive on instead of latching a decision made with
  // none.
  test("is pending in team mode when the round has a finish order but no scores yet", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, {}, "player_0", true), "pending");
  });

  // Free-for-all never reads placementPoints at all — an absent score set must
  // not stall a mode that was never waiting on one.
  test("free-for-all is never pending, even with no scores at all", () => {
    assert.equal(roundOutcomeFor(TEAMS_TABLE, drawnFinishingOrder, {}, "player_0", false), "won");
  });
});

// The sting is latched once, so it waits for every ranked id's score in every mode: online, that is
// also when a match's winners have arrived, and a match-ending round must not sting as a round.
describe("scoredOutcome", () => {
  const order = ["player_0", "player_1"];

  test("holds a free-for-all outcome at pending until every ranked id is scored", () => {
    assert.equal(scoredOutcome("won", order, {}), "pending");
    assert.equal(scoredOutcome("won", order, { player_0: 3 }), "pending");
    assert.equal(scoredOutcome("won", order, { player_0: 3, player_1: 0 }), "won");
  });

  test("a round nobody finished has nothing to wait for", () => {
    assert.equal(scoredOutcome("neutral", [], {}), "neutral");
  });
});

describe("matchOutcomeFor", () => {
  const FREE_TABLE = [{ id: "player_0" }, { id: "player_1" }, { id: "player_2" }];
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("a drawn match is the same draw for every co-winner, whichever is listed first", () => {
    for (const winners of [["player_0", "player_2"], ["player_2", "player_0"]]) {
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_0", false), "draw");
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_2", false), "draw");
      assert.equal(matchOutcomeFor(FREE_TABLE, winners, "player_1", false), "lost");
    }
  });

  test("a teams match listing both partners is won by each of them", () => {
    const winners = ["player_3", "player_0"];
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_0", true), "won");
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_3", true), "won");
    assert.equal(matchOutcomeFor(TEAMS_TABLE, winners, "player_1", true), "lost");
  });

  test("is pending until its winners are known, and neutral for a spectator", () => {
    assert.equal(matchOutcomeFor(FREE_TABLE, [], "player_0", false), "pending");
    assert.equal(matchOutcomeFor(FREE_TABLE, ["player_0"], undefined, false), "neutral");
  });
});

// `lib/game/autoMove.ts` was written to be the one bot rule and landed with only
// the server calling it, so the offline copy stayed live behind a green
// extraction: every check passed, because each mode's tests exercised its own
// implementation. Counting the callers of the engine's move chooser is the
// fact that distinguishes one implementation from two — a second one has to
// call it, whatever else it does.
test("one module chooses a bot's move", () => {
  const HOME = "lib/game/autoMove.ts";
  for (const chooser of ["botChoosePlay", "pickGivebackCard"]) {
    const callers = appSources().filter((rel) =>
      new RegExp(String.raw`(?<!function )\b${chooser}\s*\(`).test(readFileSync(path.join(repoRoot, rel), "utf8"))
    );

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
    new RegExp(String.raw`\b${fn}\s*\(`).test(readFileSync(path.join(repoRoot, rel), "utf8"));
  const callers = ["context/GameContext.tsx", "tests/helpers/offlineMatch.ts"];

  assert.deepEqual(callers.filter((rel) => !calls(rel, "offlineBotMove")), [], "must call offlineBotMove");
  assert.ok(
    !calls("context/GameContext.tsx", "autoMoveForSeat"),
    "GameContext.tsx choosing a move itself is a second offline bot the harness never plays"
  );
});

describe("offlineBotMove", () => {
  const card = (id: string): Card => ({ id, rank: "9", suit: id === "9s" ? "spades" : "hearts", isJoker: false });
  const leading = (type: PlayerType): GameState => ({
    players: [
      { id: "player_0", name: "Bot", type, hand: [card("9s"), card("9h")] },
      { id: "player_1", name: "You", type: "human", hand: [{ ...card("4s"), rank: "4" }] },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
    playedRanks: emptyRankTally(),
  });

  test("plays a bot at full strength, not the floor an AFK human gets", () => {
    const state = leading("bot");
    const floor = autoMoveForSeat(state, 0, "floor")!.state.lastPlayedCombination!.cards.map((c) => c.id);
    const played = offlineBotMove(state)?.state.lastPlayedCombination?.cards.map((c) => c.id);
    assert.equal(floor.length, 1);
    assert.deepEqual(played?.toSorted(), ["9h", "9s"], "the bot finishes with the pair; the floor would lead one card");
  });

  test("leaves a human's turn alone", () => {
    assert.equal(offlineBotMove(leading("human")), null);
  });

  // The e2e hook `murlanBotMove` calls this whenever a spec asks, round over or not.
  test("answers null, never a throw, when the round is over", () => {
    assert.equal(offlineBotMove({ ...leading("bot"), roundOver: true }), null);
    assert.equal(autoMoveForSeat({ ...leading("bot"), roundOver: true }, 0, "bot"), null);
  });
});

test("only lib/game/autoMove.ts reaches the bot heuristics in lib/game/bot.ts", () => {
  const importers = appSources().filter((rel) =>
    /from\s+["'](?:\.\/|@\/lib\/game\/|[./]+\/lib\/game\/)bot(?:\.ts)?["']/.test(
      readFileSync(path.join(repoRoot, rel), "utf8")
    )
  );

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

function appSources(): string[] {
  return ["app", "components", "context", "lib", "server"].flatMap((dir) =>
    walk(path.join(repoRoot, dir))
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
    }
  }
  return out;
}
