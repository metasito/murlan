// tests/engine/offlineSave.test.ts — what survives an app being killed, and what a
// stored blob has to look like before it is trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OFFLINE_SAVE_VERSION,
  decodeOfflineSave as decode,
  encodeOfflineSave,
  isResumable,
} from "../../lib/offlineSave.ts";
import { buildCombination } from "../../lib/game/gameEngine.ts";
import { played } from "../support/moves.ts";

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
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: false,
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

// The version is the real guard. A blob from an older build is discarded rather
// than migrated, because restoring a hand into a shape the engine no longer
// expects corrupts a game silently, while losing one abandoned match costs
// nothing — the same call active_games makes.
test("a save from another version is discarded, not migrated, and says so", () => {
  const older = JSON.parse(encodeOfflineSave(save()));
  older.version = OFFLINE_SAVE_VERSION - 1;
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
  const start = gameState.players[gameState.currentTurnIndex].hand.find((c) => c.id === gameState.startCard?.id);
  assert.ok(start, "the seat on move does not hold the start card");
  const combo = buildCombination([start]);
  assert.ok(combo);
  const after = played(gameState, combo);
  assert.equal(after.firstPlayMade, true);
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
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: { id: "A_spades", rank: "A", suit: "spades", isJoker: false },
      twoJokerException: false,
    };
    return JSON.stringify(blob);
  };
  assert.equal(kindOf(withExchange([])), "incompatible");
  assert.equal(kindOf(withExchange([{ id: "5_clubs", rank: "5", suit: "clubs", isJoker: false }])), "ok");
  assert.equal(kindOf(withExchange([null])), "incompatible");
  assert.equal(kindOf(withExchange([{ id: "5_clubs" }])), "incompatible");
});
