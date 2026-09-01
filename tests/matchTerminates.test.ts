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
// Default run is 200 seeds — cheap (a manche is a few hundred synchronous
// engine calls) and, per the ticket, high enough that a 1-in-10 stall cannot
// pass by luck (0.9^200 is effectively zero). Pass MURLAN_MATCH_SOAK_SEEDS
// for a longer local search; CI never sets it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MatchStallError,
  simulateOfflineMatch,
  type SimulateMatchResult,
} from "./helpers/offlineMatch.ts";

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
  for (let seed = 1; seed <= SOAK_SEEDS; seed++) {
    let result: SimulateMatchResult;
    try {
      result = simulateOfflineMatch({ seed, ...TWO_PLAYER_MATCH });
    } catch (err) {
      if (err instanceof MatchStallError) {
        failures.push(err);
        continue;
      }
      throw err;
    }
    assert.ok(
      result.winners.length > 0 || result.isDraw,
      `seed ${seed}: match.over with no winners and no draw`
    );
  }

  if (failures.length > 0) {
    const [first] = failures;
    assert.fail(
      `${failures.length}/${SOAK_SEEDS} seeds never reached the match target ` +
        `(seeds: ${failures.map((f) => f.seed).join(", ")}). First: ${first.message}`
    );
  }
});
