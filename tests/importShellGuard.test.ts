// tests/importShellGuard.test.ts — the guard the CLI-script suites use to prove
// that importing a script does not run its command-line body. Its own floor:
// a guard that cannot see a script shelling out proves nothing, and one that
// reports a timeout as `expected 0, got null` sends the reader after the wrong
// thing (#409).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importUnderShellGuard } from "./helpers/importShellGuard.ts";

/** Writes `source` as an .mjs module and returns its file URL. */
function moduleWith(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-subject-"));
  const file = path.join(dir, "subject.mjs");
  fs.writeFileSync(file, source, "utf8");
  return pathToFileURL(file).href;
}

describe("importUnderShellGuard", () => {
  test("a module that only defines things never shells out", () => {
    const url = moduleWith("export const answer = 42;\n");

    assert.equal(importUnderShellGuard(url).shelledOutTo, null);
  });

  test("names the command when the module shells out on import", () => {
    // The regression every caller of this guard exists to catch: a CLI body
    // that runs at import time instead of waiting to be invoked.
    const url = moduleWith(
      "import { execFileSync } from 'node:child_process';\nexecFileSync('gh', ['issue', 'list']);\n"
    );

    assert.equal(importUnderShellGuard(url).shelledOutTo, "gh");
  });

  test("a timeout says so, rather than reporting a null exit status", () => {
    // A timer keeps the loop alive, so the child really does hang rather than
    // falling out of an empty event loop.
    const url = moduleWith("setInterval(() => {}, 1000);\nawait new Promise(() => {});\n");

    assert.throws(
      () => importUnderShellGuard(url, { timeoutMs: 1_000 }),
      /timed out/,
      "a killed child must name the timeout, not surface `status: null`"
    );
  });

  test("a module that throws on import reports its own stderr", () => {
    const url = moduleWith("throw new Error('boom from the module');\n");

    assert.throws(() => importUnderShellGuard(url), /boom from the module/);
  });
});
