// tests/botTotalTimeWatchdog.test.ts — #770: `driveGameToCompletion`'s two
// watchdogs both watch the table advancing, so a game that keeps changing
// state and keeps moving cards out of hands while never reaching
// `isFinished` satisfies both of them forever. This is what actually
// happened on the one recorded stall (CI run 33556887782): a bare 300s
// Playwright timeout with `""` for a URL, not a diagnostic from either
// watchdog. `maxTotalMs` is the bound that answers "the game itself, not a
// turn or a state, never finished" — a fake `Page` that never satisfies
// `isFinished` and never repeats a table description (so neither existing
// watchdog fires first) is enough to drive the loop without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { driveGameToCompletion, StuckError } from "./e2e/helpers/bot.ts";
import { TABLE } from "./e2e/helpers/selectors.ts";

/**
 * A description that changes every poll and names no hand sizes, so
 * `stallMs` and `maxStatesWithoutProgress` both stay satisfied — the shape
 * `maxTotalMs` alone is left to catch.
 */
function fakePage(): Page {
  let poll = 0;
  const locator = (selector: string) => {
    if (selector === '[data-testid="btn-rematch-no"]') {
      return { count: async () => 0, isVisible: async () => false };
    }
    if (selector === TABLE) {
      return {
        count: async () => 1,
        getAttribute: async () => `Waiting, poll ${poll++}.`,
      };
    }
    throw new Error(`fakePage: unexpected locator "${selector}"`);
  };
  return { locator } as unknown as Page;
}

test("a game that keeps advancing without ever finishing is caught by maxTotalMs, not left to Playwright's own timeout", async () => {
  await assert.rejects(
    () =>
      driveGameToCompletion(fakePage(), {
        isFinished: async () => false,
        maxTotalMs: 50,
        stallMs: 60_000,
        maxStatesWithoutProgress: 100_000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof StuckError, `expected StuckError, got ${err}`);
      assert.match((err as Error).message, /did not reach isFinished within/);
      return true;
    }
  );
});
