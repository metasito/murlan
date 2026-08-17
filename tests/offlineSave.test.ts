// tests/offlineSave.test.ts — what survives an app being killed, and what a
// stored blob has to look like before it is trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_SAVE_VERSION,
  decodeOfflineSave,
  encodeOfflineSave,
  isResumable,
} from "../lib/offlineSave.ts";

const save = (over = false) => ({
  gameState: {
    players: [
      { id: "player_0", name: "Ana", hand: [], type: "human" },
      { id: "player_1", name: "Luan", hand: [], type: "ai" },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: false,
  },
  match: { length: "match", target: 21, scores: { player_0: 3 }, hands: [], over, winners: [], isDraw: false },
  rematchAnswers: {},
  players: [
    { name: "Ana", type: "human" },
    { name: "Luan", type: "ai", personality: "luan" },
  ],
  gameMode: "free_for_all",
}) as never;

test("a save round-trips", () => {
  const decoded = decodeOfflineSave(encodeOfflineSave(save()));
  assert.ok(decoded);
  assert.equal(decoded.version, OFFLINE_SAVE_VERSION);
  assert.equal(decoded.gameState.players.length, 2);
  assert.equal(decoded.match.scores.player_0, 3);
  assert.equal(decoded.players[1].personality, "luan");
});

// The version is the real guard. A blob from an older build is discarded rather
// than migrated, because restoring a hand into a shape the engine no longer
// expects corrupts a game silently, while losing one abandoned match costs
// nothing — the same call active_games makes.
test("a save from another version is discarded, not migrated", () => {
  const older = JSON.parse(encodeOfflineSave(save()));
  older.version = OFFLINE_SAVE_VERSION - 1;
  assert.equal(decodeOfflineSave(JSON.stringify(older)), null);
  older.version = OFFLINE_SAVE_VERSION + 1;
  assert.equal(decodeOfflineSave(JSON.stringify(older)), null);
});

test("nothing stored, or nothing parseable, is simply nothing", () => {
  for (const raw of [null, "", "not json", "[]", '"a string"', "null", "42"]) {
    assert.equal(decodeOfflineSave(raw), null, JSON.stringify(raw));
  }
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
    ["match without hands", (s) => { (s.match as Record<string, unknown>).hands = "nope"; }],
    ["no rematch answers", (s) => delete s.rematchAnswers],
    ["no player setup", (s) => delete s.players],
    ["setup that disagrees with the seats", (s) => { s.players = [{ name: "Ana", type: "human" }]; }],
    ["an unknown game mode", (s) => { s.gameMode = "battle_royale"; }],
  ];
  for (const [what, mutate] of mutations) {
    const blob = JSON.parse(encodeOfflineSave(save()));
    mutate(blob);
    assert.equal(decodeOfflineSave(JSON.stringify(blob)), null, what);
  }
});

test("a match still running is resumable; a finished one is not", () => {
  assert.equal(isResumable(decodeOfflineSave(encodeOfflineSave(save(false)))), true);
  assert.equal(isResumable(decodeOfflineSave(encodeOfflineSave(save(true)))), false);
  assert.equal(isResumable(null), false);
});

// The result screen between manches: the hand is over, the match is not, and
// the next manche is still to deal. That is exactly when a player is most
// likely to put the phone down.
test("a finished hand inside a running match is still resumable", () => {
  const blob = JSON.parse(encodeOfflineSave(save(false)));
  blob.gameState.gameOver = true;
  assert.equal(isResumable(decodeOfflineSave(JSON.stringify(blob))), true);
});
