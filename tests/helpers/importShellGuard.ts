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
  // Armed last, so the clock starts when the module does: a deadline the parent keeps is
  // spent booting Node before the module has run a line, and the module is what it is for.
  // Its own file rather than an exit code, for the same reason the call above has one — a
  // module is free to exit with any status, and none of them may mean something here.
  "const budget = Number(process.env.GUARD_BUDGET_MS);",
  "if (Number.isFinite(budget) && budget > 0) {",
  "  setTimeout(() => {",
  "    fs.writeFileSync(process.env.GUARD_HUNG_MARKER, String(budget));",
  "    process.exit(1);",
  "  }, budget).unref();",
  "}",
].join("\n");

/**
 * How long the child may take to boot and then die on its own, over its own budget.
 *
 * The parent's timeout is a backstop for a child that cannot even do that — one killed
 * before `--require` ran, or one whose deadline was cleared. It is not the budget, so it
 * has no reason to be tight.
 */
const BOOT_BACKSTOP_MS = 30_000;

export interface ShellGuardResult {
  shelledOutTo: string | null;
}

export interface ShellGuardOptions {
  /**
   * How long the module itself may run. Counted in the child, from the moment it starts,
   * so booting Node spends none of it.
   */
  timeoutMs?: number;
}

/**
 * Imports `moduleUrl` in a child Node with any shelling out recorded and
 * refused, and reports what it tried to run.
 */
export function importUnderShellGuard(
  moduleUrl: string,
  { timeoutMs = 60_000 }: ShellGuardOptions = {}
): ShellGuardResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-guard-"));
  const marker = path.join(dir, "called.txt");
  const hungMarker = path.join(dir, "hung.txt");
  const preload = path.join(dir, "preload.cjs");
  fs.writeFileSync(preload, PRELOAD, "utf8");

  try {
    // No `-e` argv[1], so a script guarding on `isInvokedDirectly` must read
    // itself as imported and leave its CLI body alone.
    const code =
      `import(${JSON.stringify(moduleUrl)})` +
      `.then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });`;
    const result = spawnSync(process.execPath, ["--require", preload, "-e", code], {
      env: {
        ...process.env,
        GUARD_MARKER: marker,
        GUARD_HUNG_MARKER: hungMarker,
        GUARD_BUDGET_MS: String(timeoutMs),
      },
      encoding: "utf8",
      timeout: timeoutMs + BOOT_BACKSTOP_MS,
    });

    // Before anything that could go wrong afterwards: the preload writes this
    // synchronously, so a module that shelled out and then hung has still
    // answered the question, and the hang is the less interesting half.
    if (fs.existsSync(marker)) return { shelledOutTo: fs.readFileSync(marker, "utf8") };

    if (fs.existsSync(hungMarker)) {
      throw new Error(`importing ${moduleUrl} timed out after ${timeoutMs}ms`);
    }

    // Node sets ETIMEDOUT on every platform when the timeout is what killed the
    // child, so the signal alone does not identify one: an OOM kill or a
    // SIGSEGV also sets it, and calling either a timeout sends the reader after
    // a budget when the machine ran out of memory.
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      throw new Error(
        `importing ${moduleUrl} never reached its own ${timeoutMs}ms deadline, and was killed ` +
          `after ${timeoutMs + BOOT_BACKSTOP_MS}ms. The child could not boot, or could not die`
      );
    }
    if (result.signal) {
      throw new Error(`importing ${moduleUrl} was killed by ${result.signal}`);
    }

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`importing ${moduleUrl} exited ${result.status}: ${result.stderr}`);
    }

    return { shelledOutTo: null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
