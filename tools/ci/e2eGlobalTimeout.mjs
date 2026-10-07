const MARGIN_MS = 2 * 60_000;
export function localGlobalTimeoutMs(env, ceilingMs) {
  if (env.CI) return undefined;
  const cap = ceilingMs - MARGIN_MS;
  const n = Number(env.E2E_GLOBAL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : cap;
}
