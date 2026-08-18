// tests/persistedEnvelope.test.ts — what rides alongside the engine state in
// the stored game_state blob, and what must not survive being read back.
//
// handFlags (which seats played a bomb or a joker this hand) travels in the
// envelope so a restart mid-hand does not cost those seats their bomb/joker
// achievement eligibility. It does NOT get a column of its own: a new column
// cannot be written until someone runs db:push on Replit, and until they do
// every persist would fail silently — a worse failure than the one avoided.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_SCHEMA_VERSION,
  isStaleSchema,
  packPersistedState,
  unpackPersistedState,
  type HandFlags,
} from "../server/onlineGameLogic.ts";

const gameState = { currentTurnIndex: 2, gameOver: false, players: [{ id: "player_0" }] };
const flags: HandFlags = { 0: { bomb: true, joker: false }, 3: { bomb: false, joker: true } };

describe("persisted game_state envelope", () => {
  test("hand flags survive a persist/restore round trip", () => {
    const restored = unpackPersistedState(packPersistedState(gameState, flags, 0));
    assert.deepEqual(restored.handFlags, flags);
  });

  test("the deal rotation survives a persist/restore round trip", () => {
    const restored = unpackPersistedState(packPersistedState(gameState, flags, 3));
    assert.equal(restored.dealFirstSeat, 3);
    assert.ok(!("dealFirstSeat" in restored.gameState));
  });

  test("a row written before the deal rotation existed restores from seat 0", () => {
    const legacy = { ...gameState, schemaVersion: GAME_SCHEMA_VERSION };
    assert.equal(unpackPersistedState(legacy).dealFirstSeat, 0);
  });

  test("the engine state comes back byte-for-byte, with no envelope fields on it", () => {
    // The restored state is broadcast to every client and compared against
    // engine output — a stray schemaVersion or handFlags on it is a real bug.
    const restored = unpackPersistedState(packPersistedState(gameState, flags, 0));
    assert.deepEqual(restored.gameState, gameState);
    assert.ok(!("schemaVersion" in restored.gameState));
    assert.ok(!("handFlags" in restored.gameState));
    assert.ok(!("dealFirstSeat" in restored.gameState));
  });

  test("a row written before hand flags existed restores as empty, not undefined", () => {
    // Callers index this by seat immediately; undefined would throw on rehydrate.
    const legacy = { ...gameState, schemaVersion: GAME_SCHEMA_VERSION };
    const restored = unpackPersistedState(legacy);
    assert.deepEqual(restored.handFlags, {});
    assert.deepEqual(restored.gameState, gameState);
  });

  test("a legacy row is not treated as stale — no live game is discarded for this change", () => {
    // Adding a field to the envelope must not bump the schema version: doing
    // so would reject every game in flight at deploy time.
    const legacy = { ...gameState, schemaVersion: GAME_SCHEMA_VERSION };
    assert.equal(isStaleSchema(legacy), false);
    assert.equal(isStaleSchema(packPersistedState(gameState, flags, 0)), false);
  });

  test("the envelope still carries the version a stale row is detected by", () => {
    const packed = packPersistedState(gameState, flags, 0);
    assert.equal(packed.schemaVersion, GAME_SCHEMA_VERSION);
    assert.equal(isStaleSchema({ ...gameState, schemaVersion: GAME_SCHEMA_VERSION + 1 }), true);
    assert.equal(isStaleSchema(null), true);
  });

  test("packing does not mutate the caller's game state", () => {
    const original = { ...gameState };
    packPersistedState(gameState, flags, 0);
    assert.deepEqual(gameState, original);
  });
});
