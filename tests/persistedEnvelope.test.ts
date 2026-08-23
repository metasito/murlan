// tests/persistedEnvelope.test.ts — the stored game_state blob is the whole
// row, and reading it back is a trust boundary.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_SCHEMA_VERSION,
  packPersistedState,
  persistedEnvelopeSchema,
  persistedMatchSchema,
  unpackPersistedState,
  type HandFlags,
  type PersistedMatch,
} from "../server/onlineGameLogic.ts";

const gameState = {
  currentTurnIndex: 2,
  gameOver: false,
  gameMode: "teams",
  players: [{ id: "player_0" }],
};
const flags: HandFlags = { 0: { bomb: true, joker: false }, 3: { bomb: false, joker: true } };
const match: PersistedMatch = {
  playerMap: { 0: "alice", 3: "dan" },
  scores: { alice: 7, dan: 12 },
  gameMode: "free_for_all",
  matchLength: "match",
  matchTarget: 21,
  maxPlayers: 4,
  isPublic: true,
};

const JOIN_CODE = "QW3RTY";

const pack = (over: Partial<PersistedMatch> = {}) =>
  packPersistedState(gameState, flags, 3, JOIN_CODE, { ...match, ...over });

/** The restored side of a round trip, or a failure naming the rejection. */
function restore(persisted: unknown) {
  const result = unpackPersistedState<typeof gameState>(persisted);
  assert.ok(result.ok, `refused: ${result.ok ? "" : result.reason}`);
  return result;
}

describe("persisted game_state envelope", () => {
  test("a round trip preserves seats, scores, target and length", () => {
    const restored = restore(pack());
    assert.deepEqual(restored.match, match);
  });

  test("hand flags and the deal rotation survive a round trip", () => {
    const restored = restore(pack());
    assert.deepEqual(restored.handFlags, flags);
    assert.equal(restored.dealFirstSeat, 3);
  });

  test("the join code survives a round trip", () => {
    // A cold-start rejoin draws the room screen from this when the `rooms`
    // row is gone; without it there is no six-character code to show.
    assert.equal(restore(pack()).joinCode, JOIN_CODE);
  });

  test("the engine state comes back byte-for-byte, with no envelope fields on it", () => {
    // The restored state is broadcast to every client and compared against
    // engine output — a stray schemaVersion or handFlags on it is a real bug.
    const restored = restore(pack());
    assert.deepEqual(restored.gameState, gameState);
  });

  test("the match's game mode does not overwrite the hand's", () => {
    // GameState carries its own gameMode. A flat envelope would have the two
    // share a key, and the hand on the table would come back a different game.
    const restored = restore(pack({ gameMode: "free_for_all" }));
    assert.equal(restored.gameState.gameMode, "teams");
    assert.equal(restored.match.gameMode, "free_for_all");
  });

  test("packing does not mutate the caller's game state", () => {
    const original = { ...gameState };
    packPersistedState(gameState, flags, 0, JOIN_CODE, match);
    assert.deepEqual(gameState, original);
  });

  test("the envelope carries the version a stale row is detected by", () => {
    assert.equal(pack().schemaVersion, GAME_SCHEMA_VERSION);
  });

  test("the schemas are the envelope's only field declaration", () => {
    // The write side is held to the same shape the read side parses: a field
    // added to one and not the other breaks here, at test time, instead of at
    // cold-start restore.
    assert.deepEqual(
      ["schemaVersion", ...Object.keys(persistedEnvelopeSchema.shape)],
      Object.keys(pack()),
    );
    assert.deepEqual(Object.keys(persistedMatchSchema.shape), Object.keys(match));
  });
});

describe("rows the restore path refuses", () => {
  /** The rejection reason, or a failure if the row was restored instead. */
  function refusal(persisted: unknown): string {
    const result = unpackPersistedState(persisted);
    assert.equal(result.ok, false, "restored a row that should have been refused");
    return result.ok ? "" : result.reason;
  }

  test("a row at the previous version", () => {
    // Every field moved into the envelope by this bump is absent from a
    // version-1 row, so half of it would restore as undefined.
    assert.match(refusal({ ...pack(), schemaVersion: 1 }), /schema version 1/);
  });

  test("a row with no version stamp at all", () => {
    assert.match(refusal({ ...gameState }), /schema version undefined/);
    assert.match(refusal(null), /not an object/);
    assert.match(refusal("{}"), /not an object/);
  });

  test("a non-numeric score", () => {
    assert.match(refusal(pack({ scores: { alice: "7" } as never })), /scores/);
    assert.match(refusal(pack({ scores: { alice: NaN } })), /scores/);
    assert.match(refusal(pack({ scores: null as never })), /scores/);
  });

  test("an unexpected game mode or match length", () => {
    assert.match(refusal(pack({ gameMode: "solo" as never })), /game mode solo/);
    assert.match(refusal(pack({ matchLength: "best_of_3" as never })), /match length/);
  });

  test("a missing or nonsensical match target, table size or visibility", () => {
    assert.match(refusal(pack({ matchTarget: 0 })), /match target/);
    assert.match(refusal(pack({ matchTarget: undefined as never })), /match target/);
    assert.match(refusal(pack({ maxPlayers: -1 })), /max players/);
    assert.match(refusal(pack({ isPublic: undefined as never })), /visibility/);
  });

  test("a missing engine state, hand flags, deal rotation or match block", () => {
    assert.match(refusal({ ...pack(), gameState: null }), /game state/);
    assert.match(refusal({ ...pack(), handFlags: undefined }), /hand flags/);
    assert.match(refusal({ ...pack(), dealFirstSeat: "3" }), /deal rotation/);
    assert.match(refusal({ ...pack(), match: undefined }), /match state/);
  });

  test("a missing join code", () => {
    assert.match(refusal({ ...pack(), joinCode: undefined }), /join code/);
    assert.match(refusal({ ...pack(), joinCode: "" }), /join code/);
  });

  test("a seat map entry that is not a seat is dropped, not restored", () => {
    // The map decides whose cards a rejoining player is sent, so an entry it
    // cannot read must not survive as one it can.
    const restored = restore(pack({ playerMap: { 0: "alice", x: "bob", 1: 42 } as never }));
    assert.deepEqual(restored.match.playerMap, { 0: "alice" });
  });
});
