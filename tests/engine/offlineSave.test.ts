// tests/engine/offlineSave.test.ts — what survives an app being killed, and what a
// stored blob has to look like before it is trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OFFLINE_SAVE_VERSION,
  OLDEST_OFFLINE_SAVE_VERSION,
  decodeOfflineSave as decode,
  encodeOfflineSave,
  isResumable,
} from "../../lib/offlineSave.ts";
import { actingSeat, buildCombination, emptyRankTally, startRound } from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { played, playRoundOut } from "../support/moves.ts";
import type { MatchState } from "../../lib/game/matchState.ts";

const decodeOfflineSave = (raw: string | null) => {
  const result = decode(raw);
  return result.kind === "ok" ? result.save : null;
};
const kindOf = (raw: string | null) => decode(raw).kind;

const save = (over = false) => ({
  gameState: {
    players: [
      { id: "player_0", name: "Ana", hand: [], type: "human" },
      { id: "player_1", name: "Luan", hand: [], type: "bot", personality: "luan" },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
  },
  match: { length: "match", target: 21, scores: { player_0: 3 }, rounds: [], over, winners: [], isDraw: false },
  dealFirstSeat: 1,
}) as never;

test("a save round-trips", () => {
  const decoded = decodeOfflineSave(encodeOfflineSave(save()));
  assert.ok(decoded);
  assert.equal(decoded.version, OFFLINE_SAVE_VERSION);
  assert.equal(decoded.gameState.players.length, 2);
  assert.equal(decoded.match.scores.player_0, 3);
  assert.equal(decoded.gameState.players[1].personality, "luan");
  assert.equal(decoded.dealFirstSeat, 1, "the deal rotation survives a restart");
});

test("a save with no deal rotation at all is not trusted", () => {
  const blob = JSON.parse(encodeOfflineSave(save()));
  delete blob.dealFirstSeat;
  assert.equal(kindOf(JSON.stringify(blob)), "incompatible");
});

// A blob older than the oldest version still resumed is discarded rather than
// migrated, because restoring a hand into a shape the engine no longer
// expects corrupts a game silently, while losing one abandoned match costs
// nothing — the same call active_games makes.
test("a save from another version is discarded, not migrated, and says so", () => {
  const older = JSON.parse(encodeOfflineSave(save()));
  older.version = OLDEST_OFFLINE_SAVE_VERSION - 1;
  assert.equal(kindOf(JSON.stringify(older)), "incompatible");
  older.version = OFFLINE_SAVE_VERSION + 1;
  assert.equal(kindOf(JSON.stringify(older)), "incompatible");
  assert.equal(kindOf(encodeOfflineSave(save())), "ok");
});

test("nothing stored, or nothing parseable, is simply nothing", () => {
  for (const raw of [null, "", "not json", "[]", '"a string"', "null", "42"]) {
    assert.equal(kindOf(raw), "none", JSON.stringify(raw));
  }
});

const THREE_SPADES = { id: "3_spades", suit: "spades", rank: "3", isJoker: false };

for (const [version, openingCard] of [[5, THREE_SPADES], [6, THREE_SPADES]] as const) {
  test(`a version-${version} save resumes whole, its opening card carried over, and plays a legal move`, () => {
    const raw = readFileSync(new URL(`../fixtures/offlineSave.v${version}.json`, import.meta.url), "utf8");
    const stored = JSON.parse(raw);
    assert.equal(stored.version, version);
    assert.ok(OLDEST_OFFLINE_SAVE_VERSION <= version && version < OFFLINE_SAVE_VERSION);
    const restored = decodeOfflineSave(raw);
    assert.ok(restored, `the version-${version} save no longer decodes`);
    const { firstPlayMade: _played, startCard: _start, trickWinner: _closed, ...kept } = stored.gameState;
    assert.deepEqual(restored.gameState, { ...kept, openingCard });
    const { gameState } = restored;
    const start = gameState.players[gameState.currentTurnIndex].hand.find((c) => c.id === gameState.openingCard?.id);
    assert.ok(start, "the seat on move does not hold the opening card");
    assert.equal(played(gameState, buildCombination([start])!).openingCard, null);
    assert.ok(autoMoveForSeat(gameState, actingSeat(gameState), "floor"), "the engine refused every move");
  });
}

for (const [name, kind, moveKind] of [["open", "open", "giveback"], ["twoJokers", "twoJokers", "play"]] as const) {
  test(`a version-7 save written mid-exchange (${name}) resumes as the phase union and plays the legal move`, () => {
    const raw = readFileSync(new URL(`../fixtures/offlineSave.v7.${name}.json`, import.meta.url), "utf8");
    const stored = JSON.parse(raw);
    assert.equal(stored.version, 7);
    const restored = decodeOfflineSave(raw);
    assert.ok(restored, `the version-7 ${name} save no longer decodes`);
    const { active: _active, twoJokerException: _jokers, ...phase } = stored.gameState.exchangePhase;
    assert.deepEqual(restored.gameState, { ...stored.gameState, exchangePhase: { kind, ...phase } });
    const seat = actingSeat(restored.gameState);
    assert.equal(seat, phase.winnerIdx);
    assert.equal(autoMoveForSeat(restored.gameState, seat, "floor")?.move.kind, moveKind);
  });
}

test("the golden save of this version still decodes and plays a legal move", () => {
  const raw = readFileSync(new URL("../fixtures/offlineSave.json", import.meta.url), "utf8");
  assert.equal(
    JSON.parse(raw).version,
    OFFLINE_SAVE_VERSION,
    "OFFLINE_SAVE_VERSION moved: regenerate tests/fixtures/offlineSave.json through encodeOfflineSave"
  );
  const restored = decodeOfflineSave(raw);
  assert.ok(restored, "the fixture no longer decodes");
  const { gameState } = restored;
  const start = gameState.players[gameState.currentTurnIndex].hand.find((c) => c.id === gameState.openingCard?.id);
  assert.ok(start, "the seat on move does not hold the start card");
  const combo = buildCombination([start]);
  assert.ok(combo);
  const after = played(gameState, combo);
  assert.equal(after.openingCard, null);
  assert.deepEqual(after.lastMove, { seq: 1, kind: "play", seat: gameState.currentTurnIndex });
  assert.notEqual(after.currentTurnIndex, gameState.currentTurnIndex);
});

// Each of these is a field the restore path dereferences immediately, so a
// truncated blob has to fail here rather than as a null crash three screens on.
test("a blob missing anything the restore path needs is refused", () => {
  const mutations: [string, (s: Record<string, unknown>) => void][] = [
    ["no gameState", (s) => delete s.gameState],
    ["gameState without players", (s) => { (s.gameState as Record<string, unknown>).players = undefined; }],
    ["no seats at all", (s) => { (s.gameState as Record<string, unknown>).players = []; }],
    ["no match", (s) => delete s.match],
    ["match without scores", (s) => { (s.match as Record<string, unknown>).scores = undefined; }],
    ["match without rounds", (s) => { (s.match as Record<string, unknown>).rounds = "nope"; }],
    ["an unknown game mode", (s) => { (s.gameState as Record<string, unknown>).gameMode = "battle_royale"; }],
    ["gameState without its last move", (s) => { delete (s.gameState as Record<string, unknown>).lastMove; }],
    ["a last move without a count", (s) => { (s.gameState as Record<string, unknown>).lastMove = { kind: "deal" }; }],
    ["gameState without its played-rank tally", (s) => { delete (s.gameState as Record<string, unknown>).playedRanks; }],
    ["a match round without its points", (s) => { (s.match as Record<string, unknown>).rounds = [{ finishingOrder: [] }]; }],
  ];
  for (const [what, mutate] of mutations) {
    const blob = JSON.parse(encodeOfflineSave(save()));
    mutate(blob);
    assert.equal(kindOf(JSON.stringify(blob)), "incompatible", what);
  }
});

test("a match still running is resumable; a finished one is not", () => {
  assert.equal(isResumable(decodeOfflineSave(encodeOfflineSave(save(false)))), true);
  assert.equal(isResumable(decodeOfflineSave(encodeOfflineSave(save(true)))), false);
  assert.equal(isResumable(null), false);
});

// The result screen between rounds: the round is over, the match is not, and
// the next round is still to deal. That is exactly when a player is most
// likely to put the phone down.
test("a finished round inside a running match is still resumable", () => {
  const blob = JSON.parse(encodeOfflineSave(save(false)));
  blob.gameState.roundOver = true;
  assert.equal(isResumable(decodeOfflineSave(JSON.stringify(blob))), true);
});

test("an open exchange the winner cannot give back from is refused; one they can is kept", () => {
  const withExchange = (winnerHand: unknown[]) => {
    const blob = JSON.parse(encodeOfflineSave(save()));
    blob.gameState.players[0].hand = winnerHand;
    blob.gameState.exchangePhase = {
      kind: "open",
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: { id: "A_spades", rank: "A", suit: "spades", isJoker: false },
    };
    return JSON.stringify(blob);
  };
  assert.equal(kindOf(withExchange([])), "incompatible");
  assert.equal(kindOf(withExchange([{ id: "5_clubs", rank: "5", suit: "clubs", isJoker: false }])), "ok");
  assert.equal(kindOf(withExchange([null])), "incompatible");
  assert.equal(kindOf(withExchange([{ id: "5_clubs" }])), "incompatible");
});

test("every state a played round passes through, exchange and all, saves and resumes whole", () => {
  const seats = ["Ana", "Luan", "Gent", "Besnik"].map((name, i) => ({ name, type: i === 0 ? ("human" as const) : ("bot" as const) }));
  const match: MatchState = { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false };
  for (const opening of [undefined, { kind: "exchange" as const, winnerSeat: 2, loserSeat: 0 }]) {
    const states = playRoundOut(startRound(seats, "free_for_all", opening && { opening }));
    assert.ok(states.length > 13);
    for (const [step, gameState] of states.entries()) {
      const back = decode(encodeOfflineSave({ gameState, match, dealFirstSeat: 0 }));
      assert.equal(back.kind, "ok", `${opening?.kind ?? "start card"} step ${step}`);
      assert.deepEqual(back.kind === "ok" && back.save.gameState, JSON.parse(JSON.stringify(gameState)));
    }
  }
});
