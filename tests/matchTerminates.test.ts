// #770 — an offline 2-player match sometimes never reaches its target, and
// the e2e watchdogs cannot see it: `driveGameToCompletion` (tests/e2e/helpers/bot.ts)
// only guards "the turn froze" and "no card moved". Neither fires while
// manches keep completing and the match itself never ends, so the only
// symptom on record was a bare 300s Playwright timeout.
//
// This harness plays real offline matches — the real engine, the real bot AI
// on both seats, no browser — over many seeds and asserts every one reaches
// `match.over`. It is the missing guard rotonmeta's comment on #770 asked
// for, run standalone rather than folded into `driveGameToCompletion`: that
// helper drives a page, this drives the engine directly, and a stall here
// points at lib/gameEngine.ts or context/GameContext.tsx rather than at
// Playwright.
//
// Default run is seeds 1..200 — cheap (a manche is a few hundred synchronous
// engine calls) and, per the ticket, high enough that a 1-in-10 stall cannot
// pass by luck (0.9^200 is effectively zero). CI never overrides the band,
// so this stays deterministic run to run. `.github/workflows/soak.yml` moves
// MURLAN_MATCH_SOAK_START forward on a schedule so the search covers new
// ground over time without making this check flaky; MURLAN_MATCH_SOAK_SEEDS
// widens the count for a longer local run of either band.
//
// A `SilentSeatError` (a seat dealt cards never given a turn — #770's own
// worked example is `processPlay`'s turn-advance made a no-op) and an
// `AiTurnKeyCollision` (two different engine states hashing to the same
// `app/game.tsx` `aiTurnKey`, so a real render would never reschedule the
// second AI decision) are both left uncaught by the seed loop below: either
// is a defect this harness can prove on its own terms, not a "took too many
// manches" stall, and each names what it found without needing the seed loop
// to translate it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MatchStallError,
  simulateOfflineMatch,
  type AiTurnKeyCollision,
  type SimulateMatchResult,
} from "./helpers/offlineMatch.ts";

const SOAK_START = Number(process.env.MURLAN_MATCH_SOAK_START ?? 1);
const SOAK_SEEDS = Number(process.env.MURLAN_MATCH_SOAK_SEEDS ?? 200);

const TWO_PLAYER_MATCH = {
  players: [
    { name: "You", type: "human" as const },
    { name: "Bot", type: "ai" as const },
  ],
  gameMode: "free_for_all" as const,
  length: "match" as const,
};

test("an offline 2-player match reaches its target over many shuffles", () => {
  const failures: MatchStallError[] = [];
  const collisions: AiTurnKeyCollision[] = [];
  let aiTurnKeyChecks = 0;

  for (let i = 0; i < SOAK_SEEDS; i++) {
    const seed = SOAK_START + i;
    let result: SimulateMatchResult;
    try {
      result = simulateOfflineMatch({
        seed,
        ...TWO_PLAYER_MATCH,
        collectAiTurnKeyCollisions: collisions,
      });
    } catch (err) {
      if (err instanceof MatchStallError) {
        failures.push(err);
        continue;
      }
      throw err;
    }
    aiTurnKeyChecks += result.aiTurnKeyChecks;
    assert.ok(
      result.winners.length > 0 || result.isDraw,
      `seed ${seed}: match.over with no winners and no draw`
    );
  }

  if (failures.length > 0) {
    const [first] = failures;
    assert.fail(
      `${failures.length}/${SOAK_SEEDS} seeds (from ${SOAK_START}) never reached the match ` +
        `target (seeds: ${failures.map((f) => f.seed).join(", ")}). First: ${first.message}`
    );
  }

  if (collisions.length > 0) {
    const [first] = collisions;
    assert.fail(
      `${collisions.length} aiTurnKey collision(s) across ${aiTurnKeyChecks} states checked. ` +
        `First: seed ${first.seed}, manche ${first.mancheIndex}, key "${first.key}", ` +
        `hands ${first.before.fingerprint} -> ${first.after.fingerprint}`
    );
  }
});
