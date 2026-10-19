// The only reader of the e2e build flags. `EXPO_PUBLIC_*` is inlined at bundle build time, so only a build
// the e2e harness made (scripts/e2e-server.mjs, ios.yml, maestro.yml) ever takes an e2e branch.
//
// Relative imports and no `react-native`: `node --test` loads it (tests/tooling/e2eConfig.test.ts).
import { E2E_REAL_EXCHANGE_KEY, E2E_SUSPEND_BOT_KEY } from "./storageKeys.ts";

/** Read per call so a test can flip the flag; a build inlines it. */
export const e2eFast = (): boolean => process.env.EXPO_PUBLIC_E2E_FAST === "1";

/**
 * A key the e2e harness wrote before the bundle evaluated. The build gate short-circuits: no build
 * outside the harness reads the store at all.
 */
export function storedFlag(key: string): boolean {
  if (!e2eFast()) return false;
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
