import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Patching `child_process.execFileSync` in the child, rather than shimming
 * PATH: a bare `execFileSync("gh", …)` with no shell resolves through OS-level
 * search rules that do not reliably prefer a shadowing PATH entry (confirmed
 * against the real `gh` on Windows). Patching catches the call at its source,
 * deterministically and without ever touching the network.
 */
const PRELOAD = [
  "const cp = require('node:child_process');",
  "const fs = require('node:fs');",
  "cp.execFileSync = function (file) {",
  "  fs.writeFileSync(process.env.GUARD_MARKER, String(file));",
  "  throw new Error('blocked: ' + file + ' must not run during import');",
  "};",
].join("\n");

export interface ShellGuardResult {
  /** The command the module ran while being imported, or null if it ran none. */
  shelledOutTo: string | null;
}

export interface ShellGuardOptions {
  /** A hang guard, not a budget — `shelledOutTo` is what proves the property. */
  timeoutMs?: number;
}

/**
 * Imports `moduleUrl` in a child Node with any shelling out recorded and
 * refused, and reports what it tried to run. Throws — naming the timeout, the
 * signal or the module's own stderr — when the child never got as far as
 * answering that question.
 */
export function importUnderShellGuard(
  moduleUrl: string,
  { timeoutMs = 60_000 }: ShellGuardOptions = {}
): ShellGuardResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard-"));
  const marker = path.join(dir, "called.txt");
  const preload = path.join(dir, "preload.cjs");
  fs.writeFileSync(preload, PRELOAD, "utf8");

  try {
    // No `-e` argv[1], so a script guarding on `isInvokedDirectly` must read
    // itself as imported and leave its CLI body alone.
    const code =
      `import(${JSON.stringify(moduleUrl)})` +
      `.then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });`;
    const result = spawnSync(process.execPath, ["--require", preload, "-e", code], {
      env: { ...process.env, GUARD_MARKER: marker },
      encoding: "utf8",
      timeout: timeoutMs,
    });

    // A killed child reports as ETIMEDOUT on Windows and as a bare signal with
    // a null status elsewhere. Either way the question this asks went
    // unanswered, and saying which is the difference between a diagnosis and
    // `expected 0, got null`.
    const timedOut =
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      result.signal !== null;
    if (timedOut) {
      throw new Error(
        `importing ${moduleUrl} timed out after ${timeoutMs}ms` +
          (result.signal ? ` (killed by ${result.signal})` : "")
      );
    }
    // Read before judging the exit status: blocking the call is what made the
    // import throw, so a module that shells out always exits non-zero. That is
    // the answer this returns, not a failure to reach one.
    if (fs.existsSync(marker)) return { shelledOutTo: fs.readFileSync(marker, "utf8") };

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`importing ${moduleUrl} exited ${result.status}: ${result.stderr}`);
    }

    return { shelledOutTo: null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
