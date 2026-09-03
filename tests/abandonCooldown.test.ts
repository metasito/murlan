// tests/abandonCooldown.test.ts — #858: repeat abandonment gates matchmaking,
// never rating, and never on the first or second offence. Every case moves
// the clock rather than waiting, per docs/agents/RULES.md #6.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  abandonCooldown,
  ABANDON_COOLDOWN_THRESHOLD,
  ABANDON_COOLDOWN_WINDOW_MS,
  ABANDON_COOLDOWN_MS,
} from "../lib/abandonCooldown.ts";

const NOW = new Date("2026-09-03T12:00:00.000Z");

/** `n` abandonment timestamps, most recent `msAgo`, one minute apart. */
function abandonmentsEndingAt(n: number, msAgo: number): Date[] {
  const last = NOW.getTime() - msAgo;
  return Array.from({ length: n }, (_, i) => new Date(last - i * 60_000));
}

describe("abandonCooldown", () => {
  test("one under the threshold does nothing — a first offence costs nothing", () => {
    const state = abandonCooldown(abandonmentsEndingAt(ABANDON_COOLDOWN_THRESHOLD - 1, 0), NOW);
    assert.equal(state.active, false);
  });

  test("crossing the threshold within the window gates matchmaking", () => {
    const state = abandonCooldown(abandonmentsEndingAt(ABANDON_COOLDOWN_THRESHOLD, 0), NOW);
    assert.equal(state.active, true);
    assert.equal(state.until?.getTime(), NOW.getTime() + ABANDON_COOLDOWN_MS);
  });

  test("an abandonment older than the rolling window does not count toward it", () => {
    const justOutside = ABANDON_COOLDOWN_WINDOW_MS + 1;
    const state = abandonCooldown(
      [...abandonmentsEndingAt(ABANDON_COOLDOWN_THRESHOLD - 1, 0), new Date(NOW.getTime() - justOutside)],
      NOW
    );
    assert.equal(state.active, false);
  });

  test("expiry is read off the clock, not waited for", () => {
    const abandonments = abandonmentsEndingAt(ABANDON_COOLDOWN_THRESHOLD, 0);
    const stillGated = abandonCooldown(abandonments, new Date(NOW.getTime() + ABANDON_COOLDOWN_MS - 1));
    assert.equal(stillGated.active, true);

    const lifted = abandonCooldown(abandonments, new Date(NOW.getTime() + ABANDON_COOLDOWN_MS + 1));
    assert.equal(lifted.active, false);
  });
});
