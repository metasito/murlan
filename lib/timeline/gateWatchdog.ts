/**
 * How long a table gate waits on its frame clock before it releases itself. A flat literal, never
 * derived from a motion token or a timeline (`tests/ui-rules/oneClock.test.ts`): a fallback that
 * sits well past every healthy gate (`tests/ui-rules/gateWatchdog.test.ts`), not the timing.
 */
export const GATE_WATCHDOG_MS = 10_000;
