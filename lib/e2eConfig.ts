// The only reader of the e2e build flags. `EXPO_PUBLIC_*` is inlined at bundle build time, so only a build
// the e2e harness made (scripts/e2e-server.mjs, ios.yml, maestro.yml) ever takes an e2e branch.
//
// Relative imports and no `react-native`: `node --test` loads it (tests/tooling/e2eConfig.test.ts), so a
// platform is handed in by the caller rather than read here.
import type { ExchangeHold } from "./game/sharedGameFlow.ts";
import { E2E_REAL_EXCHANGE_KEY, E2E_SUSPEND_BOT_KEY } from "./storageKeys.ts";

export const E2E_FAST = process.env.EXPO_PUBLIC_E2E_FAST === "1";

/**
 * A key the e2e harness wrote before the bundle evaluated. The build gate short-circuits: no build
 * outside the harness reads the store at all.
 */
export function storedFlag(key: string): boolean {
  if (!E2E_FAST) return false;
  try {
    const store = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    return store?.getItem(key) === "1";
  } catch {
    // Where a browser blocks site data, reading the property itself throws.
    return false;
  }
}

/** The harness's knobs, read once as the bundle evaluates. */
export const e2e = {
  /** A seeded capture state holds the offline bot turn loop (tests/e2e/helpers/offlineSeed.ts). */
  suspendBot: storedFlag(E2E_SUSPEND_BOT_KEY),
  /** A spec playing the shipped motion path gets the real exchange close, not the held overlay. */
  realExchange: storedFlag(E2E_REAL_EXCHANGE_KEY),
};

/**
 * Whether setupGame deals the opener to the viewer. A launch argument on iOS lands in NSUserDefaults,
 * which `readLaunchArg` reads; Android and web have no such channel, and no other build reads it at all.
 */
export function opener(os: string, readLaunchArg: () => unknown): boolean {
  return E2E_FAST && os === "ios" && String(readLaunchArg()) === "1";
}

const MEASURED_TAP_RETURN_MS = 8200;
const E2E_EXCHANGE_HOLD_MARGIN_MS = 4000;

/**
 * How long the offline exchange overlay holds in an e2e build; undefined for a real player and for a spec
 * that opted out. Under Maestro it holds until `.maestro/exchange-phase.yaml` taps it: no fixed hold covers
 * how long a device can keep Maestro from reading the screen. One view-hierarchy read on the Android
 * emulator took 22 s while the round ended, and a Passa tap returned 37.5 s later, past the whole ceremony
 * (#1560). The web build keeps a timed hold, because Playwright specs play through the exchange without
 * ever tapping it.
 */
export function exchangeHold(os: string): ExchangeHold | undefined {
  if (!E2E_FAST || e2e.realExchange) return undefined;
  return os === "web" ? MEASURED_TAP_RETURN_MS + E2E_EXCHANGE_HOLD_MARGIN_MS : "untilTapped";
}

// The build mark: a string in a bundle built with any test-only flag and nothing in one built without.
// The literals stay in this condition so the minifier drops the dead branch; `scripts/e2eBuildMark.mjs`
// reads the built output for it, and `tests/tooling/e2eBuildMark.test.ts` fails if the app reads a flag
// this condition does not name.
if (
  process.env.EXPO_PUBLIC_E2E_FAST === '1' ||
  process.env.EXPO_PUBLIC_E2E_REDUCE_MOTION === '1'
) {
  (globalThis as { murlanE2EBuild?: string }).murlanE2EBuild = 'murlan-e2e-build';
}
