// Every e2e build holds the offline exchange overlay open on a timer
// (`context/GameContext.tsx`), which replaces the close path a player's build
// runs. A spec that plays the shipped motion path writes this key before the
// bundle evaluates, and gets the real close.
import { E2E_REAL_EXCHANGE_KEY } from "./storageKeys.ts";

export { E2E_REAL_EXCHANGE_KEY };

/**
 * `e2eFast` is `EXPO_PUBLIC_E2E_FAST`, inlined at bundle build time, and it
 * short-circuits: no build outside the e2e harness reads the flag at all.
 */
export function realExchange(e2eFast: boolean): boolean {
  if (!e2eFast) return false;
  try {
    const store = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    return store?.getItem(E2E_REAL_EXCHANGE_KEY) === "1";
  } catch {
    // Where a browser blocks site data, reading the property itself throws.
    return false;
  }
}
