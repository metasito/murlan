// tests/botSearchTimeout.test.ts — #770: `stallMs` and `maxStatesWithoutProgress`
// (and `maxTotalMs`, tests/botTotalTimeWatchdog.test.ts) all compare table
// descriptions *between* calls to `playOrPass` — none of them can see time spent
// inside one call. `HUMAN_TURN_SECONDS` (app/game.tsx) is a real 20s wall-clock
// deadline that `EXPO_PUBLIC_E2E_FAST` deliberately leaves unscaled
// (tests/e2e/tableFit.spec.ts drives it out for real), so a hand whose reply
// needs a near-exhaustive candidate search — up to 18 cards at 2 players
// (tests/e2e/helpers/bot.ts's own comment) — can race that deadline turn after
// turn without any existing watchdog ever naming it: the search keeps "playing",
// so `stallMs` and `maxStatesWithoutProgress` both stay satisfied, and the only
// trace was #770's bare 300s Playwright timeout with `""` for a URL.
//
// `SearchTimeoutError` closes that blind spot: a fake `Page` whose GIOCA never
// accepts anything (every candidate is "no") drives `playOrPass` through its
// whole search with a deadline already in the past, so the very first
// candidate it tries throws immediately rather than after a real 18s wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { driveGameToCompletion, SearchTimeoutError, StuckError } from "./e2e/helpers/bot.ts";
import { TABLE, HAND_CARDS } from "./e2e/helpers/selectors.ts";

const YOUR_TURN_DESC =
  'È il tuo turno. Luan ha giocato Re di Cuori. Luan ha 5 carte in mano. Hai 2 carte in mano.';

/** A hand whose reply search never satisfies GIOCA, so it runs the full search every call. */
function fakePage(): Page {
  const locator = (selector: string) => {
    if (selector === '[data-testid="btn-rematch-no"]') {
      return { count: async () => 0, isVisible: async () => false };
    }
    if (selector === '[data-testid="start-reason-gate"]') {
      return { count: async () => 0 };
    }
    if (selector === TABLE) {
      return { count: async () => 1, getAttribute: async () => YOUR_TURN_DESC };
    }
    if (selector === HAND_CARDS) {
      return {
        evaluateAll: async () => [
          { label: "Asso di Fiori", selected: false },
          { label: "2 di Picche", selected: false },
        ],
      };
    }
    if (selector.startsWith(HAND_CARDS)) {
      // A specific card's own locator, reached by `cardByLabel` inside a click —
      // unreachable once the deadline is already past, since `tryCombo` throws
      // before ever calling `setSelection`.
      throw new Error(`fakePage: unexpected click on ${selector}`);
    }
    if (selector === '[data-testid="btn-gioca"]') {
      return { getAttribute: async () => "Gioca — non disponibile: nessuna carta selezionata" };
    }
    if (selector === '[data-testid="btn-passa"]') {
      return { isEnabled: async () => true };
    }
    throw new Error(`fakePage: unexpected locator "${selector}"`);
  };
  return { locator } as unknown as Page;
}

test("a reply search that outruns its budget throws SearchTimeoutError, not a silent grind", async () => {
  await assert.rejects(
    () =>
      driveGameToCompletion(fakePage(), {
        isFinished: async () => false,
        // Already elapsed: deterministic regardless of how fast the fakes resolve.
        searchBudgetMs: -1,
        stallMs: 60_000,
        maxStatesWithoutProgress: 100_000,
        maxTotalMs: 60_000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof SearchTimeoutError, `expected SearchTimeoutError, got ${err}`);
      assert.ok(err instanceof StuckError, "SearchTimeoutError must still be a StuckError");
      assert.match((err as Error).message, /ran past -?\d+ms/);
      assert.match((err as Error).message, /HUMAN_TURN_SECONDS/);
      return true;
    }
  );
});
