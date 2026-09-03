// Repeat-abandonment cooldown — docs/design/DISCONNECT-POLICY.md §6.12:
// "Repetition escalates, on the record, as a matchmaking cooldown — never as
// a larger rating loss, and never on the first offence." The policy names the
// shape of the gate but not a number; ABANDON_COOLDOWN_WINDOW_MS,
// ABANDON_COOLDOWN_THRESHOLD and ABANDON_COOLDOWN_MS below are this ticket's
// own choice (#858) and need the owner's word before they are load-bearing.
//
// Pure and DB-free on purpose, mirroring lib/streak.ts: the caller (server
// only — a cooldown is never a client decision) reads the abandoned rows and
// hands their timestamps in, so this is testable by moving a clock argument
// rather than a real one.

/** A rolling day: old habits age out rather than following a player forever. */
export const ABANDON_COOLDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The first two abandonments in the window cost nothing; the third gates. */
export const ABANDON_COOLDOWN_THRESHOLD = 3;

/** How long matchmaking stays gated once the threshold is crossed. */
export const ABANDON_COOLDOWN_MS = 15 * 60 * 1000;

export interface CooldownState {
  active: boolean;
  /** When the cooldown lifts. Always present when `active` is true. */
  until?: Date;
}

/**
 * `abandonedAt` is a player's abandonment timestamps, any order or length.
 * The cooldown runs `ABANDON_COOLDOWN_MS` from the most recent one inside the
 * window, not from `now` — a fixed span after the habit, so it counts down
 * rather than resetting on every failed matchmaking attempt.
 */
export function abandonCooldown(abandonedAt: Date[], now: Date): CooldownState {
  const windowStart = now.getTime() - ABANDON_COOLDOWN_WINDOW_MS;
  const inWindow = abandonedAt
    .filter((at) => at.getTime() > windowStart)
    .sort((a, b) => b.getTime() - a.getTime());
  if (inWindow.length < ABANDON_COOLDOWN_THRESHOLD) return { active: false };

  const until = new Date(inWindow[0]!.getTime() + ABANDON_COOLDOWN_MS);
  if (until.getTime() <= now.getTime()) return { active: false };
  return { active: true, until };
}
