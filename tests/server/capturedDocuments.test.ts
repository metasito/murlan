// What this revision writes and sends, captured, must read back as it did when it was captured:
// a stored row and an offline save outlive a deploy, and a client's payload outlives the bundle.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_SCHEMA_VERSION, unpackPersistedState } from "../../shared/persistedEnvelope.ts";
import { decodeOfflineSave } from "../../lib/offlineSave.ts";
import {
  GameEndMatchVoteSchema,
  GamePlaySchema,
  NoPayloadSchema,
  RoomStartSchema,
} from "../../shared/socketSchemas.ts";
import { gameStateSchema, roomStateSchema, roundOverSchema } from "../../shared/protocol.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const row = JSON.parse(fixture(`activeGames.v${GAME_SCHEMA_VERSION}.json`));

const without = (doc: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => !keys.includes(key)));

const withMatch = (over: Record<string, unknown>) => ({ ...row, match: { ...row.match, ...over } });

function restored(doc: unknown) {
  const result = unpackPersistedState(doc);
  assert.ok(result.ok, `refused: ${result.ok ? "" : result.reason}`);
  return result;
}

function reason(doc: unknown): string {
  const result = unpackPersistedState(doc);
  assert.equal(result.ok, false, "restored a row that should be refused");
  return result.ok ? "" : result.reason;
}

describe("a row this revision writes", () => {
  test("restores exactly as written", () => {
    assert.equal(row.schemaVersion, GAME_SCHEMA_VERSION);
    assert.ok(row.pendingResults.length > 0 && row.moveLog.length > 0, "the capture exercises every block");
    assert.deepStrictEqual(restored(row), {
      ok: true,
      ...without(row, "schemaVersion"),
      unreadablePendingResults: 0,
    });
  });

  test("drops what a finished round's outcome does not declare, and counts an entry it cannot read", () => {
    const [entry] = row.pendingResults;
    const back = restored({ ...row, pendingResults: [{ ...entry, outcome: { ...entry.outcome, newer: 1 } }, { round: "x" }] });
    assert.deepStrictEqual(back.pendingResults, [entry]);
    assert.equal(back.unreadablePendingResults, 1);
  });

  const fallbacks = {
    moveLog: null,
    replayOpening: null,
    pendingResults: [],
    seq: 0,
    seats: { vacatedSeats: [], releasedSeats: [], weakSeats: [], abandonedSeats: [] },
  };
  const matchFallbacks = { playerMap: {}, roundsPlayed: 0, endedByVote: false };
  const rows = {
    "absent": {
      ...without(row, ...Object.keys(fallbacks)),
      match: without(row.match, ...Object.keys(matchFallbacks)),
    },
    "malformed": {
      ...row,
      moveLog: "x", replayOpening: 5, pendingResults: "x", seq: -1, seats: 3,
      match: { ...row.match, playerMap: 4, roundsPlayed: "x", endedByVote: 1 },
    },
    "null": {
      ...row,
      moveLog: null, replayOpening: null, pendingResults: null, seq: null, seats: null,
      match: { ...row.match, playerMap: null, roundsPlayed: null, endedByVote: null },
    },
  };
  for (const [name, doc] of Object.entries(rows)) {
    test(`with its defaulted and filtered fields ${name}, restores them as their fallbacks`, () => {
      assert.deepStrictEqual(restored(doc), {
        ok: true,
        ...without(row, "schemaVersion"),
        ...fallbacks,
        match: { ...row.match, ...matchFallbacks },
        unreadablePendingResults: 0,
      });
    });
  }

  test("refused, says why in the words the schema gives", () => {
    const flags = (roundFlags: unknown) => ({ ...row, roundFlags });
    const cases: [unknown, string][] = [
      [withMatch({ scores: undefined }), "scores are not all numbers"],
      [withMatch({ scores: null }), "scores are not all numbers"],
      [withMatch({ scores: { a: "7" } }), "scores are not all numbers"],
      [withMatch({ scores: { a: NaN } }), "scores are not all numbers"],
      [withMatch({ scores: { a: Infinity } }), "scores are not all numbers"],
      [withMatch({ scores: { a: undefined } }), "scores are missing"],
      [withMatch({ gameMode: "solo" }), "game mode solo"],
      [withMatch({ gameMode: undefined }), "game mode undefined"],
      [withMatch({ matchLength: "bo3" }), "match length bo3"],
      [withMatch({ matchTarget: undefined }), "match target missing"],
      [withMatch({ matchTarget: "21" }), "match target missing"],
      [withMatch({ matchTarget: 2.5 }), "match target missing"],
      [withMatch({ matchTarget: 0 }), "match target missing"],
      [withMatch({ maxPlayers: undefined }), "max players missing"],
      [withMatch({ maxPlayers: -1 }), "max players missing"],
      [withMatch({ matchOver: undefined }), "match verdict missing"],
      [withMatch({ matchOver: "yes" }), "match verdict missing"],
      [{ ...row, match: undefined }, "no match state"],
      [{ ...row, match: "x" }, "no match state"],
      [flags(undefined), "no round flags"],
      [flags([]), "no round flags"],
      [flags({ 0: "x" }), "no round flags"],
      [flags({ 0: { bomb: "yes", joker: false } }), "round flags are not all booleans"],
      [flags({ 0: { bomb: true } }), "round flags are not all booleans"],
      [{ ...row, dealFirstSeat: undefined }, "no deal rotation"],
      [{ ...row, dealFirstSeat: "3" }, "no deal rotation"],
      [{ ...row, dealFirstSeat: 1.5 }, "no deal rotation"],
      [{ ...row, dealFirstSeat: -1 }, "no deal rotation"],
      [{ ...row, joinCode: undefined }, "no join code"],
      [{ ...row, joinCode: "" }, "no join code"],
      [{ ...row, joinCode: 7 }, "no join code"],
      [{ ...row, gameState: undefined }, "no game state"],
    ];
    assert.deepEqual(
      cases.map(([doc]) => reason(doc)),
      cases.map(([, said]) => said),
    );
  });

  test("whose engine state is refused, names the field it stopped at", () => {
    const gameState = (over: Record<string, unknown>) => ({ ...row, gameState: { ...row.gameState, ...over } });
    const players = (seat: number, over: Record<string, unknown>) =>
      row.gameState.players.map((p: Record<string, unknown>, i: number) => (i === seat ? { ...p, ...over } : p));
    const held = row.gameState.players[0].hand[0];
    assert.equal(
      reason(gameState({ players: players(2, { personality: "nope" }) })),
      "game state players.2.personality: an unknown bot personality",
    );
    assert.equal(
      reason(gameState({ playedRanks: [1] })),
      "game state playedRanks: a played-rank tally of other than 15 ranks",
    );
    assert.equal(
      reason(gameState({ players: players(1, { hand: [...row.gameState.players[1].hand, held] }) })),
      `card ${held.id} more than once`,
    );
    assert.match(reason(gameState({ players: [{ id: "player_0" }] })), /^game state players\.0\.name: /);
    assert.match(reason(gameState({ playedRanks: undefined })), /^game state playedRanks: /);
    assert.match(reason(gameState({ gameMode: "x" })), /^game state gameMode: /);
    assert.match(reason(gameState({ lastMove: { seq: 1, kind: "jump" } })), /^game state lastMove: /);
  });
});

test("the offline save this revision writes decodes exactly as written", () => {
  const raw = fixture("offlineSave.json");
  const decoded = decodeOfflineSave(raw);
  assert.equal(decoded.kind, "ok");
  assert.deepStrictEqual(decoded.kind === "ok" ? decoded.save : null, JSON.parse(raw));
});

describe("a payload this revision's bundle sends or reads", () => {
  const parsed = (schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: unknown) => {
    const result = schema.safeParse(value);
    return result.success ? result.data : "refused";
  };

  test("game:play keeps what it names, and drops what it does not", () => {
    assert.deepStrictEqual(parsed(GamePlaySchema, { cardIds: ["3_spades", "3_hearts"], turn: "t41", intentId: "i1" }), {
      cardIds: ["3_spades", "3_hearts"],
      turn: "t41",
    });
    assert.equal(parsed(GamePlaySchema, { cardIds: [], turn: "t41" }), "refused");
  });

  test("an event with no payload, room:start and the end-match vote read as they did", () => {
    assert.deepStrictEqual([undefined, null, { a: 1 }, 5].map((v) => parsed(NoPayloadSchema, v)), [{}, {}, {}, "refused"]);
    assert.deepStrictEqual(
      [undefined, null, {}, { fillWithBots: true, botPersonality: "gent", matchLength: "single", extra: 1 }].map((v) =>
        parsed(RoomStartSchema, v)
      ),
      [{}, {}, {}, { fillWithBots: true, botPersonality: "gent", matchLength: "single" }],
    );
    assert.deepStrictEqual(
      [undefined, null, {}, { wants: false }, { wants: "no" }].map((v) => parsed(GameEndMatchVoteSchema, v)),
      [{ wants: true }, { wants: true }, { wants: true }, { wants: false }, "refused"],
    );
  });

  test("game:state keeps every field it does not check, and defaults a missing finish order", () => {
    const sent = {
      players: [{ id: "player_0", name: "Ana", hand: [{ id: "3_spades", rank: "3" }], handCount: 1, vacated: false }],
      currentTurnIndex: 0,
      roundOver: false,
      playedRanks: [],
      openingCard: null,
      turn: "t1",
      seq: 4,
    };
    assert.deepStrictEqual(parsed(gameStateSchema, sent), { ...sent, finishingOrder: [] });
    assert.deepStrictEqual(parsed(gameStateSchema, { ...sent, finishingOrder: ["player_0"] }), {
      ...sent,
      finishingOrder: ["player_0"],
    });
  });

  test("game:round_over and the room state keep every field they do not check", () => {
    const outcome = {
      ...row.pendingResults[0].outcome,
      ratingDeltas: { "user-1": 12 },
      ratingsAfter: { "user-1": { rating: 1012, rounds: 3 } },
      newer: 1,
    };
    assert.deepStrictEqual(parsed(roundOverSchema, outcome), outcome);
    assert.equal(parsed(roundOverSchema, { ...outcome, ratingDeltas: { "user-1": "12" } }), "refused");
    const room = {
      roomId: "r1",
      code: "QW3RTY",
      status: "waiting",
      players: [{ seatIndex: 0, userId: "user-0", username: "Ana", ready: true }],
      newer: 2,
    };
    assert.deepStrictEqual(parsed(roomStateSchema, room), room);
  });
});
