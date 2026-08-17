import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAchievements, ACHIEVEMENTS } from "../lib/achievements.ts";

const base = { userId: "u1", placement: 1, playerCount: 4, playedBomb: false, playedJoker: false, matchWon: false, opponentsFinished: 3 };

test("winning a hand unlocks first_win", () => {
  assert.ok(evaluateAchievements(base).includes("first_win"));
});

test("winning without a joker unlocks purist", () => {
  assert.ok(evaluateAchievements({ ...base, playedJoker: false }).includes("purist"));
  assert.ok(!evaluateAchievements({ ...base, playedJoker: true }).includes("purist"));
});

test("losing unlocks nothing", () => {
  assert.deepEqual(evaluateAchievements({ ...base, placement: 4 }), []);
});

test("every achievement has translation keys present in the catalogue", async () => {
  // locales/it.ts has a named export `it`, not a default export (see
  // tests/i18n.test.ts for the same import shape) — the brief's literal
  // `{ default: it }` destructure would resolve to undefined here.
  const { it } = await import("../locales/it.ts");
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.nameKey in it, `missing ${a.nameKey}`);
    assert.ok(a.descKey in it, `missing ${a.descKey}`);
  }
});

test("every achievement is reachable by at least one constructible GameResult", () => {
  // Guards against dead-code predicates like the original `full_table`,
  // which required `opponentsFinished === 3` in a 4-player game even though
  // lib/gameEngine.ts:687-690 (the last-place player is auto-assigned their
  // finish position without ever emptying their hand — see docs/RULES.md
  // §9) caps `opponentsFinished` at `playerCount - 2` for the winner. That
  // predicate could never fire for any real game. This test brute-forces
  // every combination of field values that the real engine can actually
  // produce and asserts every achievement id shows up at least once.
  const earned = new Set<string>();
  for (const playerCount of [2, 3, 4]) {
    // opponentsFinished never includes the last-place player, who is
    // auto-assigned without going out — so it tops out at playerCount - 2.
    const maxOpponentsFinished = Math.max(0, playerCount - 2);
    for (let placement = 1; placement <= playerCount; placement++) {
      for (const playedBomb of [false, true]) {
        for (const playedJoker of [false, true]) {
          for (const matchWon of [false, true]) {
            for (let opponentsFinished = 0; opponentsFinished <= maxOpponentsFinished; opponentsFinished++) {
              const result = {
                userId: "u1",
                placement,
                playerCount,
                playedBomb,
                playedJoker,
                matchWon,
                opponentsFinished,
              };
              for (const id of evaluateAchievements(result)) earned.add(id);
            }
          }
        }
      }
    }
  }

  for (const a of ACHIEVEMENTS) {
    assert.ok(earned.has(a.id), `${a.id} is unreachable by any constructible GameResult`);
  }
});
