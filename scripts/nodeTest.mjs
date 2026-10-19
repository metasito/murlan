// Every `node --test … --test-force-exit` in the repo runs as `node scripts/nodeTest.mjs …`, so these
// flags have one owner (tests/tooling/testHangs.test.ts fails a call site that skips it).
import { spawn } from "node:child_process";
import { isInvokedDirectly } from "./lib/entry.mjs";

/**
 * --test-force-exit ends each file with process.exit, which on Node 24 joins V8's compiler threads
 * without the main thread collecting again: a background compile job waiting on a collection then
 * hangs the exit forever, after it has already stopped the file deadline's worker (#1590).
 */
export const NO_BACKGROUND_JIT = ["--no-concurrent-recompilation", "--no-concurrent-sparkplug"];

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const child = spawn(process.execPath, [...NO_BACKGROUND_JIT, ...process.argv.slice(2)], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
}
