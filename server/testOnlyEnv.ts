import { logger } from "./logger.ts";

const reported = new Set<string>();

/**
 * A `MURLAN_*` override that exists so a test can shorten a timer, lift a limit
 * or redirect an outbound call. Undefined in production whatever the
 * environment holds, so a stray Secret cannot reach a live process.
 * `tests/testOnlyEnv.test.ts` fails on a server read that bypasses this.
 */
export function testOnlyEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || process.env.NODE_ENV !== "production") return raw;
  if (!reported.has(name)) {
    reported.add(name);
    logger.warn({ name }, "ignoring a test-only override in production");
  }
  return undefined;
}
