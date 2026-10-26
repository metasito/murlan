import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const logger = pathToFileURL(path.resolve(import.meta.dirname, "../../server/shared/logger.ts")).href;

/**
 * pino-pretty runs in a worker thread that sometimes keeps a bare `node` alive after its last test
 * passed, hanging every runner that does not force the exit (Stryker's dry run, 20 minutes each).
 */
test("a process that logs to a pipe starts no pretty-printer and ends on its own", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "murlan-logger-"));
  try {
    const script = path.join(dir, "log.mjs");
    writeFileSync(script, `import { logger } from ${JSON.stringify(logger)};\nlogger.info({ roomId: "r" }, "hello");\n`);
    const env = { ...process.env, NODE_ENV: "development" as const, LOG_PRETTY: undefined };
    const run = spawnSync(process.execPath, [script], { env, timeout: 10_000, encoding: "utf8" });
    assert.equal(run.error, undefined, "the process outlived its last line");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout.trim()).msg, "hello", "a pipe gets JSON lines, not pretty text");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
