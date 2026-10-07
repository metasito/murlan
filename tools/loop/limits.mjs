/** Plain constants, importable from a CommonJS loader: Playwright's config cannot load queue-loop.mjs. */
export const STALL_MS = 30 * 60_000;

export const CHECK_BASH_TIMEOUT_MS = STALL_MS - 5 * 60_000;
