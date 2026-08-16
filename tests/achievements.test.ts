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
