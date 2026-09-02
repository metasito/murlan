// #770 — an offline 2-player match sometimes never reaches its target, and
// the e2e watchdogs cannot see it: `driveGameToCompletion` (tests/e2e/helpers/bot.ts)
// only guards "the turn froze" and "no card moved". Neither fires while
// manches keep completing and the match itself never ends, so the only
// symptom on record was a bare 300s Playwright timeout.
//
// This harness plays real offline matches — the real engine, the real bot AI
// on every seat, no browser — over many seeds and asserts every one reaches
// `match.over`. It is the missing guard rotonmeta's comment on #770 asked
// for, run standalone rather than folded into `driveGameToCompletion`: that
// helper drives a page, this drives the engine directly, and a stall here
// points at lib/gameEngine.ts or context/GameContext.tsx rather than at
// Playwright.
//
// The 2-player band is the default and cheap (200 seeds, ~1s); CI never
// overrides it, so that check stays deterministic run to run.
// `.github/workflows/soak.yml` moves MURLAN_MATCH_SOAK_START forward on a
// schedule so the search covers new ground over time, and widens every band
// below with its own MURLAN_MATCH_SOAK_SEEDS_* override — the app runs 3-
// and 4-seat tables too, and #770's second review found the collision hunt
// had only ever run the 2-seat case.
//
// Left uncaught by every seed loop below, so each names what it found
// without the loop translating it:
//   - `SilentSeatError` — a seat dealt cards never given a turn at all.
//   - `RotationOrderError` — a turn landed on a seat other than the one
//     `getNextActivePlayer`'s own contract (decrement, skip empty hands)
//     promises, reimplemented independently in offlineMatch.ts so a bug in
//     the real function can't grade its own homework.
//   - `HandNotShrunkError` — a play was accepted (the turn moved on) but the
//     acting seat's hand didn't shed exactly the cards it played.
//   - `MatchStallError` — a manche or the match itself blew its move/manche
//     ceiling; collected rather than thrown so a soak run reports every
//     stalling seed, not just the first.
//   - `AiTurnKeyCollision` — two different engine states hashing to the same
//     `app/game.tsx` `aiTurnKey`, so a real render would never reschedule
//     the second AI decision; collected the same way as stalls.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MatchStallError,
  simulateOfflineMatch,
  type AiTurnKeyCollision,
  type OfflinePlayerSetup,
  type SimulateMatchResult,
} from "./helpers/offlineMatch.ts";

const SOAK_START = Number(process.env.MURLAN_MATCH_SOAK_START ?? 1);

/** One AI opponent per seat past the first — this repo's "ai" lobby default
 * (`app/lobby.tsx`'s `buildDefaultPlayers`), and the shape #770's second
 * review named: a human seat exists specifically so the key can go null
 * when it holds the turn, and every remaining seat is `"ai"` so the key
 * chase actually has AI-owned turns to compare. */
function tableOf(playerCount: number): OfflinePlayerSetup[] {
  return Array.from({ length: playerCount }, (_, i) => ({
    name: i === 0 ? "You" : `Bot${i}`,
    type: i === 0 ? ("human" as const) : ("ai" as const),
  }));
}

/**
 * Plays `count` seeded matches at `playerCount` seats and fails the test
 * naming every stall and every `aiTurnKey` collision found, or reports the
 * total states checked when it finds neither.
 */
function soakMatches(playerCount: number, count: number, contest?: boolean[]): void {
  const players = tableOf(playerCount);
  const failures: MatchStallError[] = [];
  const collisions: AiTurnKeyCollision[] = [];
  let aiTurnKeyChecks = 0;

  for (let i = 0; i < count; i++) {
    const seed = SOAK_START + i;
    let result: SimulateMatchResult;
    try {
      result = simulateOfflineMatch({
        seed,
        players,
        gameMode: "free_for_all",
        length: "match",
        contest,
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
      `${playerCount}p seed ${seed}: match.over with no winners and no draw`
    );
  }

  if (failures.length > 0) {
    const [first] = failures;
    assert.fail(
      `${playerCount}p: ${failures.length}/${count} seeds (from ${SOAK_START}) never reached ` +
        `the match target (seeds: ${failures.map((f) => f.seed).join(", ")}). First: ${first.message}`
    );
  }

  if (collisions.length > 0) {
    const [first] = collisions;
    assert.fail(
      `${playerCount}p: ${collisions.length} aiTurnKey collision(s) across ${aiTurnKeyChecks} ` +
        `states checked. First: seed ${first.seed}, manche ${first.mancheIndex}, ` +
        `key "${first.key}", hands ${first.before.fingerprint} -> ${first.after.fingerprint}`
    );
  }
}

// Cheap (a manche is a few hundred synchronous engine calls) and, per the
// ticket, high enough that a 1-in-10 stall cannot pass by luck (0.9^200 is
// effectively zero).
test("an offline 2-player match reaches its target over many shuffles", () => {
  soakMatches(2, Number(process.env.MURLAN_MATCH_SOAK_SEEDS ?? 200));
});

// The seat-0 "human" actually contests every round (`contest`), rather than
// the AFK floor `useAi:false` gives — #770's own recorded stall
// (resultActions.spec.ts, run 33556887782) was driven by
// tests/e2e/helpers/bot.ts's always-contesting bot, not an AFK one, and
// nothing in this file's default AI-vs-AI seeds plays that shape either.
test("an offline 2-player match reaches its target when the human seat contests every round", () => {
  soakMatches(2, Number(process.env.MURLAN_MATCH_SOAK_SEEDS ?? 200), [true, false]);
});

// 3 and 4 seats deal more cards and score every placement, not just the
// winner's, so a manche runs longer — the default here stays small enough
// that the whole file is still a sub-two-second local loop; the nightly
// soak job widens it.
test("an offline 3-player match reaches its target over many shuffles", () => {
  soakMatches(3, Number(process.env.MURLAN_MATCH_SOAK_SEEDS_3P ?? 30));
});

test("an offline 4-player match reaches its target over many shuffles", () => {
  soakMatches(4, Number(process.env.MURLAN_MATCH_SOAK_SEEDS_4P ?? 30));
});
