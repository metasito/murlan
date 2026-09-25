// tests/engine/matchState.test.ts — the seat a results board celebrates.
//
// Both modes draw the same board, so the name on it is derived once. What the
// candidates are differs (offline has a third fallback the overlay does not),
// but the rule for reading them cannot.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { celebration, isDrawnHand, handOutcomeFor } from "../../lib/game/matchState.ts";
import { autoMoveForSeat, offlineBotMove } from "../../lib/game/autoMove.ts";
import { emptyRankTally, type Card, type GameState, type PlayerType } from "../../lib/game/gameEngine.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TABLE = [
  { id: "player_0", name: "Alice", team: "A" },
  { id: "player_1", name: "Bob", team: "B" },
  { id: "player_2", name: "Carl", team: "A" },
];

const teamLabel = (team: string) => `Team ${team}`;

describe("celebration", () => {
  test("takes the first candidate that names a seat", () => {
    assert.equal(celebration(TABLE, ["player_1", "player_0"], null), "Bob");
  });

  // A client that rejoins a table which finished while it was away never
  // receives `game:over`, so it holds `over: true` with no winners at all.
  test("passes over an undefined candidate rather than rendering nothing", () => {
    assert.equal(celebration(TABLE, [undefined, "player_2"], null), "Carl");
  });

  // The winner id outliving the seat it named is the same shape as the hole
  // above, and the one a `find(c => c !== undefined)` would swallow: the
  // candidate is present, so the fallback behind it never gets its turn.
  test("passes over a candidate that names no seat", () => {
    assert.equal(celebration(TABLE, ["player_9", "player_0"], null), "Alice");
  });

  test("names the team rather than the seat when one is asked for", () => {
    assert.equal(celebration(TABLE, ["player_1"], teamLabel), "Team B");
  });

  test("names the seat where a team mode table has none", () => {
    assert.equal(celebration([{ id: "p", name: "Solo" }], ["p"], teamLabel), "Solo");
  });

  // Never the id: it reaches the screen as `player_0`, which reads as a
  // rendering fault rather than as the missing name it is.
  test("is empty when no candidate names a seat", () => {
    assert.equal(celebration(TABLE, [undefined, "player_9"], null), "");
    assert.equal(celebration(TABLE, [], null), "");
  });
});

// GAME-RULES.md §11: first-and-fourth (3+0) pays the same total as second-and-
// third (2+1), so a manche can end with both teams tied.
describe("isDrawnHand", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];

  test("first-and-fourth against second-and-third is a draw", () => {
    const handScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(isDrawnHand(TEAMS_TABLE, handScores), true);
  });

  test("a team that placed both members ahead is not a draw", () => {
    const handScores = { player_0: 3, player_1: 1, player_2: 0, player_3: 2 };
    assert.equal(isDrawnHand(TEAMS_TABLE, handScores), false);
  });

  test("a table with no team assignment is never a draw", () => {
    const handScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };
    assert.equal(
      isDrawnHand(
        TEAMS_TABLE.map(({ id }) => ({ id })),
        handScores
      ),
      false
    );
  });

  // Online, a hand's rankings reach the client before its scores do — an
  // empty or partial score set totals every team to zero, which is not the
  // same fact as every team scoring the same. "Not known yet" must read as
  // not-a-draw, or a hand whose scores just haven't arrived reports the same
  // answer as one that genuinely tied.
  test("an absent score set is not a draw", () => {
    assert.equal(isDrawnHand(TEAMS_TABLE, {}), false);
  });

  test("a partial score set — some seats not scored yet — is not a draw", () => {
    const handScores = { player_0: 3, player_1: 2 };
    assert.equal(isDrawnHand(TEAMS_TABLE, handScores), false);
  });
});

// The one function every win/lose cue reads — the table's own sting
// (components/useTableFeedback.ts) and the results board (celebration/
// celebratesViewer) both, so a teams-mode 3-3 manche is neutral on both
// paths rather than each recomputing its own placement check (#777).
describe("handOutcomeFor", () => {
  const TEAMS_TABLE = [
    { id: "player_0", team: "A" },
    { id: "player_1", team: "B" },
    { id: "player_2", team: "B" },
    { id: "player_3", team: "A" },
  ];
  // First-and-fourth (3+0) against second-and-third (2+1): a draw.
  const drawnRankings = ["player_0", "player_1", "player_2", "player_3"];
  const drawnScores = { player_0: 3, player_1: 2, player_2: 1, player_3: 0 };

  test("is neutral for every seat on a drawn teams manche", () => {
    for (const { id } of TEAMS_TABLE) {
      assert.equal(handOutcomeFor(TEAMS_TABLE, drawnRankings, drawnScores, id, true), "neutral");
    }
  });

  test("is won for the team that placed first-and-third, not just the seat that placed first", () => {
    const rankings = ["player_0", "player_1", "player_3", "player_2"];
    const scores = { player_0: 3, player_1: 2, player_3: 1, player_2: 0 };
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_0", true), "won");
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_3", true), "won");
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_1", true), "lost");
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_2", true), "lost");
  });

  test("in free-for-all, only the seat that placed first or last gets an outcome", () => {
    const rankings = ["player_2", "player_0", "player_1", "player_3"];
    const scores = { player_2: 3, player_0: 2, player_1: 1, player_3: 0 };
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_2", false), "won");
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_3", false), "lost");
    assert.equal(handOutcomeFor(TEAMS_TABLE, rankings, scores, "player_0", false), "neutral");
  });

  test("is neutral for a spectator holding no seat", () => {
    assert.equal(handOutcomeFor(TEAMS_TABLE, drawnRankings, drawnScores, undefined, true), "neutral");
  });

  test("is neutral before any manche has a finish order", () => {
    assert.equal(handOutcomeFor(TEAMS_TABLE, [], {}, "player_0", true), "neutral");
  });

  // `isTeamMode` is what gates the draw suppression on a table that merely
  // carries `.team` fields — free-for-all seats never do, which is what made
  // this guard look removable without reddening anything: nothing exercised
  // a non-teams table where `.team` happened to be set anyway.
  test("the isTeamMode guard actually gates the draw check", () => {
    assert.equal(
      handOutcomeFor(TEAMS_TABLE, drawnRankings, drawnScores, "player_0", false),
      "won"
    );
  });

  // Online, `rankings` reaches the client (`game:state`, gameOver: true) a
  // render ahead of `handScores` (the separate `game:over`) — the caller
  // (components/useTableFeedback.ts) has to be able to tell "not decided
  // yet" apart from "neutral" (an actual draw) so it knows to wait for the
  // render the scores arrive on instead of latching a decision made with
  // none.
  test("is pending in team mode when the manche has a finish order but no scores yet", () => {
    assert.equal(handOutcomeFor(TEAMS_TABLE, drawnRankings, {}, "player_0", true), "pending");
  });

  // Free-for-all never reads handScores at all — an absent score set must
  // not stall a mode that was never waiting on one.
  test("free-for-all is never pending, even with no scores at all", () => {
    assert.equal(handOutcomeFor(TEAMS_TABLE, drawnRankings, {}, "player_0", false), "won");
  });
});

// `lib/game/autoMove.ts` was written to be the one bot rule and landed with only
// the server calling it, so the offline copy stayed live behind a green
// extraction: every check passed, because each mode's tests exercised its own
// implementation. Counting the callers of the engine's move chooser is the
// fact that distinguishes one implementation from two — a second one has to
// call it, whatever else it does.
test("one module chooses a bot's move", () => {
  const CHOOSER = "aiChoosePlay";
  const HOME = "lib/game/autoMove.ts";
  const callers = appSources().filter((rel) =>
    new RegExp(String.raw`(?<!function )\b${CHOOSER}\s*\(`).test(readFileSync(path.join(repoRoot, rel), "utf8"))
  );

  assert.deepEqual(
    callers,
    [HOME],
    `${CHOOSER} is how a seat's move is chosen, so a second caller is a second ` +
      `bot. Route it through ${HOME} instead: ${callers.join(", ")}`
  );
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
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    playedRanks: emptyRankTally(),
  });

  test("plays a bot at full strength, not the floor an AFK human gets", () => {
    const state = leading("ai");
    const floor = autoMoveForSeat(state, 0, false, {})!.lastPlayedCombination!.cards.map((c) => c.id);
    const played = offlineBotMove(state)?.lastPlayedCombination?.cards.map((c) => c.id);
    assert.equal(floor.length, 1);
    assert.deepEqual(played?.toSorted(), ["9h", "9s"], "the AI finishes with the pair; the floor would lead one card");
  });

  test("leaves a human's turn alone", () => {
    assert.equal(offlineBotMove(leading("human")), null);
  });
});

test("only lib/game/autoMove.ts reaches the bot heuristics in lib/game/ai.ts", () => {
  const importers = appSources().filter((rel) =>
    /from\s+["'](?:\.\/|@\/lib\/game\/|[./]+\/lib\/game\/)ai(?:\.ts)?["']/.test(
      readFileSync(path.join(repoRoot, rel), "utf8")
    )
  );

  assert.deepEqual(importers, ["lib/game/autoMove.ts"]);
});

test("gameEngine.ts exports no bot heuristic", async () => {
  const engine = await import("../../lib/game/gameEngine.ts");
  const ai = await import("../../lib/game/ai.ts");
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
