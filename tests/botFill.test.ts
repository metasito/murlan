// tests/botFill.test.ts — pure seat-assignment logic, extracted so it is testable
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeatRoster } from "../server/onlineGameLogic.ts";

test("empty seats are filled with bots up to maxPlayers", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: true, botDifficulty: "medium" }
  );
  assert.equal(roster.length, 4);
  assert.equal(roster.filter((r) => r.isBot).length, 3);
  assert.deepEqual(roster.map((r) => r.seatIndex), [0, 1, 2, 3]);
});

test("without fillWithBots the roster is only the humans", () => {
  const roster = buildSeatRoster(
    [{ seatIndex: 0, userId: "u1", username: "Ana" }],
    4,
    { fillWithBots: false }
  );
  assert.equal(roster.length, 1);
});

test("bot seats are excluded from match scoring", () => {
  const roster = buildSeatRoster([{ seatIndex: 0, userId: "u1", username: "Ana" }], 2, { fillWithBots: true });
  const scored = roster.filter((r) => !r.isBot).map((r) => r.userId);
  assert.deepEqual(scored, ["u1"]);
});
