// tests/server/roundOverPayload.test.ts — `game:round_over` is read whole or not at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundOverSchema, type RoundOverPayload } from "../../shared/protocol.ts";

const payload: RoundOverPayload = {
  finishingOrder: ["player_1", "player_0"],
  scores: [
    { seatIndex: 0, engineId: "player_0", userId: "alice", username: "Alice", points: 0, total: 4, vacated: false },
    { seatIndex: 1, engineId: "player_1", userId: null, username: "Gent", points: 3, total: 9, vacated: false },
  ],
  matchTarget: 21,
  matchLength: "match",
  roundsPlayed: 3,
  matchOver: false,
  matchWinnerIds: [],
  matchContinues: true,
  isDraw: false,
  ratingDeltas: { alice: -4 },
  ratingsAfter: { alice: { rating: 996, rounds: 3 } },
  recorded: true,
  voided: false,
};

test("a payload with every field reads back as sent, and a field a newer server adds is kept", () => {
  assert.deepEqual(roundOverSchema.parse(payload), payload);
  assert.equal(roundOverSchema.parse({ ...payload, extra: 1 }).extra, 1);
});

test("a payload missing any one of its thirteen fields is refused", () => {
  const fields = Object.keys(payload) as (keyof RoundOverPayload)[];
  assert.equal(fields.length, 13);
  for (const field of fields) {
    const { [field]: _missing, ...short } = payload;
    assert.equal(roundOverSchema.safeParse(short).success, false, `read a round_over without ${field}`);
  }
});

test("a score line missing a field is refused", () => {
  const { vacated: _missing, ...line } = payload.scores[0];
  assert.equal(roundOverSchema.safeParse({ ...payload, scores: [line] }).success, false);
});
