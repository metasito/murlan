// #839 needed two things from tests/helpers/offlineMatch.ts that did not
// exist before: a match reproducible end to end (deal *and* the AI's
// aggression/unpredictability knobs) from one seed, via `aiRng`, and each
// manche's top-card counts, via `SimulatedManche.topCardCounts`. Pinned here
// rather than only exercised by the measurement script
// (scripts/measureHeadsUpBalance.ts) so a regression in either shows up as a
// red test, not as a quietly wrong report next time someone reruns it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateOfflineMatch, type OfflinePlayerSetup } from "./helpers/offlineMatch.ts";
import { mulberry32 } from "./helpers.ts";

const seededAi = (s: number) => mulberry32(s + 1);

test("aiRng makes a whole match — deal and AI knobs both — reproducible from one seed", () => {
  const players: OfflinePlayerSetup[] = [
    { name: "A", type: "ai", personality: "besnik" },
    { name: "B", type: "ai", personality: "ana" },
  ];
  const run = () =>
    simulateOfflineMatch({
      seed: 42,
      players,
      gameMode: "free_for_all",
      length: "match",
      aiRng: seededAi,
    });
  const a = run();
  const b = run();
  assert.deepEqual(a.manches.map((m) => m.rankings), b.manches.map((m) => m.rankings));
  assert.deepEqual(a.winners, b.winners);
});

test("a seat's personality reaches aiChoosePlay through the offline harness", () => {
  // luan is the "easy" tier (lib/botPersonalities.ts) and gent is "hard" —
  // if OfflinePlayerSetup.personality stopped reaching initializeGame /
  // initializeRematch, both seats would fall back to DEFAULT_BOT_PERSONALITY
  // and this would flatten toward 50%.
  const players: OfflinePlayerSetup[] = [
    { name: "Luan", type: "ai", personality: "luan" },
    { name: "Gent", type: "ai", personality: "gent" },
  ];
  let gentWins = 0;
  const n = 40;
  for (let i = 0; i < n; i++) {
    const r = simulateOfflineMatch({
      seed: 900_000 + i,
      players,
      gameMode: "free_for_all",
      length: "match",
      aiRng: seededAi,
    });
    if (r.winners.includes("player_1")) gentWins++;
  }
  assert.ok(
    gentWins / n >= 0.8,
    `expected the hard-tier personality to beat the easy-tier one at least 80% of the time, got ${gentWins}/${n}`
  );
});

test("topCardCounts sums to all six top cards every manche at 4 seats (nothing excluded from the deal)", () => {
  const players: OfflinePlayerSetup[] = Array.from({ length: 4 }, (_, i) => ({
    name: `Bot${i}`,
    type: "ai" as const,
  }));
  const r = simulateOfflineMatch({
    seed: 7,
    players,
    gameMode: "free_for_all",
    length: "match",
    aiRng: seededAi,
  });
  assert.ok(r.manches.length > 0);
  for (const [i, m] of r.manches.entries()) {
    const total = m.topCardCounts.reduce((a, b) => a + b, 0);
    assert.equal(total, 6, `manche ${i}: top-card counts summed to ${total}, not 6`);
  }
});

test("topCardCounts stays within [0, 6] per seat at 2 seats, where 26 of 54 cards are never dealt", () => {
  const players: OfflinePlayerSetup[] = [
    { name: "A", type: "ai" },
    { name: "B", type: "ai" },
  ];
  const r = simulateOfflineMatch({
    seed: 13,
    players,
    gameMode: "free_for_all",
    length: "match",
    aiRng: seededAi,
  });
  assert.ok(r.manches.length > 0);
  for (const [i, m] of r.manches.entries()) {
    assert.equal(m.topCardCounts.length, 2);
    for (const count of m.topCardCounts) {
      assert.ok(count >= 0 && count <= 6, `manche ${i}: seat count ${count} out of [0, 6]`);
    }
    const total = m.topCardCounts.reduce((a, b) => a + b, 0);
    assert.ok(total <= 6, `manche ${i}: top-card counts summed to ${total} > 6`);
  }
});
