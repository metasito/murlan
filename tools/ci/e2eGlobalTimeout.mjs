const MARGIN_MS = 2 * 60_000;
export function localGlobalTimeoutMs(env, ceilingMs) {
  if (env.CI) return undefined;
  const cap = ceilingMs - MARGIN_MS;
  const n = Number(env.E2E_GLOBAL_TIMEOUT_MS);
  if (!(Number.isFinite(n) && n > 0)) return cap;
  return env.LOOP_TURNS ? Math.min(n, cap) : n;
}
