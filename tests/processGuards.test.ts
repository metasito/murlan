import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

/**
 * An uncaught exception must end the process, not be logged and ignored.
 *
 * The guard is only observable from outside — asserting on it in-process would
 * mean asserting that the test runner dies — so this drives a child through the
 * real `installProcessGuards()` and reads its exit code.
 */

// A file:// href, not a path: `import()` in an --eval module rejects a bare
// Windows path as an unsupported URL scheme, and the child would then exit 1
// for that reason instead of the guard's.
const socketSafety = new URL("../server/socketSafety.ts", import.meta.url).href;

/** Runs `source` in a child under Node's own TypeScript stripping. */
function runChild(source: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", source],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

test("installProcessGuards makes an uncaught exception exit non-zero", async () => {
  const { code, stderr } = await runChild(`
    const { installProcessGuards } = await import(${JSON.stringify(socketSafety)});
    installProcessGuards();
    setTimeout(() => {
      throw new Error("uncaught from a timer");
    }, 0);
    // Keeps the loop alive past the throw, so a guard that merely logs would
    // leave the child running until this resolves and exit 0.
    setTimeout(() => process.exit(0), 3_000);
  `);

  // Without this the child can exit 1 for its own reasons — a bad import
  // specifier, a missing env var — and the assertion below passes vacuously.
  assert.doesNotMatch(
    stderr,
    /ERR_[A-Z_]+/,
    `the child must fail through the guard, not on its own error:\n${stderr}`
  );
  assert.equal(
    code,
    1,
    "a process in an undefined state must exit non-zero so the supervisor restarts it"
  );
});

test("an unhandled rejection is contained rather than fatal", async () => {
  const { code, stderr } = await runChild(`
    const { installProcessGuards } = await import(${JSON.stringify(socketSafety)});
    installProcessGuards();
    void Promise.reject(new Error("rejected with no handler"));
    setTimeout(() => process.exit(0), 500);
  `);

  assert.equal(
    code,
    0,
    `a rejection with no handler is logged, not fatal — only an uncaught exception exits\n${stderr}`
  );
});
