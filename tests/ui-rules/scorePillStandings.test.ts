import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scorePillStandings } from "../../lib/game/scorePill.ts";

const four = [
  { id: "player_0", name: "Arta" },
  { id: "player_1", name: "Luan" },
  { id: "player_2", name: "Besnik" },
  { id: "player_3", name: "Gent" },
];

describe("scorePillStandings, solo", () => {
  const s = scorePillStandings({
    players: four,
    teams: false,
    scores: { player_0: 8, player_1: 12, player_2: 8, player_3: 3 },
    handScores: { player_0: 2, player_1: 3, player_2: 1, player_3: 0 },
    rankings: ["player_1", "player_0", "player_2", "player_3"],
    viewerId: "player_0",
  });

  test("one row per seat, best first, a tie broken by the manche just played", () => {
    assert.deepEqual(
      s.rows.map((r) => r.key),
      ["player_1", "player_0", "player_2", "player_3"]
    );
  });

  test("a tie on points shares its place", () => {
    assert.deepEqual(
      s.rows.map((r) => r.place),
      [1, 2, 2, 4]
    );
  });

  test("the viewer's row is marked, and the pill at rest reads it", () => {
    assert.deepEqual(
      s.rows.map((r) => r.mine),
      [false, true, false, false]
    );
    assert.deepEqual(s.mine, { total: 8, place: 2 });
  });

  test("each row carries its total, its last gain and a one-letter disc", () => {
    assert.deepEqual(s.rows[0], { key: "player_1", name: "Luan", initial: "L", total: 12, gain: 3, place: 1, mine: false });
  });
});

describe("scorePillStandings, teams", () => {
  const players = [
    { id: "player_0", name: "Arta", team: "A" },
    { id: "player_1", name: "Luan", team: "B" },
    { id: "player_2", name: "Besnik", team: "A" },
    { id: "player_3", name: "Gent", team: "B" },
  ];
  const s = scorePillStandings({
    players,
    teams: true,
    scores: { player_0: 4, player_1: 9, player_2: 3, player_3: 1 },
    handScores: { player_0: 3, player_1: 0, player_2: 2, player_3: 1 },
    rankings: ["player_0", "player_2", "player_3", "player_1"],
    viewerId: "player_2",
  });

  test("one row per pair, its partners' points summed", () => {
    assert.deepEqual(
      s.rows.map((r) => [r.key, r.total, r.gain]),
      [
        ["B", 10, 1],
        ["A", 7, 5],
      ]
    );
  });

  test("the viewer's pair is theirs", () => {
    assert.deepEqual(
      s.rows.map((r) => r.mine),
      [false, true]
    );
    assert.deepEqual(s.mine, { total: 7, place: 2 });
  });

  test("a pair level on points is ordered by its better partner's finish", () => {
    const level = scorePillStandings({
      players,
      teams: true,
      scores: { player_0: 5, player_1: 5, player_2: 0, player_3: 0 },
      handScores: {},
      rankings: ["player_3", "player_0", "player_2", "player_1"],
      viewerId: "player_0",
    });
    assert.deepEqual(
      level.rows.map((r) => [r.key, r.place]),
      [
        ["B", 1],
        ["A", 1],
      ]
    );
  });
});

test("a spectator sees the standings and no row of their own", () => {
  const s = scorePillStandings({ players: four, teams: false, scores: {}, handScores: {}, rankings: [], viewerId: undefined });
  assert.equal(s.mine, null);
  assert.equal(s.rows.length, 4);
  assert.ok(s.rows.every((r) => r.place === 1 && r.total === 0 && !r.mine));
});
