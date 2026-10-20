// Every `node --test … --test-force-exit` in the repo runs as `node scripts/nodeTest.mjs …`, so these
// flags have one owner (tests/tooling/testHangs.test.ts fails a call site that skips it).
import { tmpdir } from "node:os";
import { hermeticEvidenceKey } from "../tools/loop/session-env.mjs";
import { isInvokedDirectly } from "./lib/entry.mjs";
import { relay } from "./lib/proc.mjs";

/**
 * --test-force-exit ends each file with process.exit, which on Node 24 joins V8's compiler threads
 * without the main thread collecting again: a background compile job waiting on a collection then
 * hangs the exit forever, after it has already stopped the file deadline's worker (#1590).
 */
export const NO_BACKGROUND_JIT = ["--no-concurrent-recompilation", "--no-concurrent-sparkplug"];

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  hermeticEvidenceKey(process.env, tmpdir());
  relay(process.execPath, [...NO_BACKGROUND_JIT, ...process.argv.slice(2)]);
}
