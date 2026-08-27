// The offline AI turn loop moves off a seeded seat about a second after
// `/game` loads (`docs/agents/loops.md`) — long enough to navigate to a
// capture state, not long enough to measure it. `tests/e2e/helpers/offlineSeed.ts`
// writes this key before the bundle evaluates.
export const E2E_SUSPEND_AI_KEY = "@murlan_e2e_suspend_ai";

/**
 * `e2eFast` is `EXPO_PUBLIC_E2E_FAST`, inlined at bundle build time, and it
 * short-circuits: no build outside the e2e harness reads the flag at all.
 */
export function suspendAI(e2eFast: boolean): boolean {
  if (!e2eFast) return false;
  try {
    const store = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    return store?.getItem(E2E_SUSPEND_AI_KEY) === "1";
  } catch {
    // Where a browser blocks site data, reading the property itself throws.
    return false;
  }
}
