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

  test("a module that shells out and then hangs still names the command", () => {
    // The hang is the less interesting half: the command it ran is the
    // diagnosis, and reporting the timeout instead throws that away.
    const url = moduleWith(
      "import { execFileSync } from 'node:child_process';\n" +
        "try { execFileSync('gh', ['issue', 'list']); } catch {}\n" +
        "setInterval(() => {}, 1000);\nawait new Promise(() => {});\n"
    );

    assert.equal(importUnderShellGuard(url, { timeoutMs: 1_000 }).shelledOutTo, "gh");
  });

  test("gives the module the whole budget, not what booting Node left of it", () => {
    // The budget is the module's, so starting the child may not spend any of it. Measured
    // here: `node -e 0` costs 100-160ms idle and more under load, so a budget counted from
    // the spawn hands a module asking for nearly all of it a deficit — and the child is
    // killed before the marker is written, which reads as a hang that never shelled out.
    const url = moduleWith(
      "import { execFileSync } from 'node:child_process';\n" +
        "await new Promise((r) => setTimeout(r, 900));\n" +
        "try { execFileSync('gh', ['issue', 'list']); } catch {}\n" +
        "setInterval(() => {}, 1000);\nawait new Promise(() => {});\n"
    );

    assert.equal(importUnderShellGuard(url, { timeoutMs: 1_000 }).shelledOutTo, "gh");
  });

  test("a module that throws on import reports its own stderr", () => {
    const url = moduleWith("throw new Error('boom from the module');\n");

    assert.throws(() => importUnderShellGuard(url), /boom from the module/);
  });
});

describe("the child's deadline", () => {
  test("says the child reached its own deadline, not that the parent gave up", () => {
    // Two different failures with two different remedies: a module that hangs is the caller's
    // to fix, and a child that cannot boot or cannot die is this helper's.
    const url = moduleWith("setInterval(() => {}, 1000);\nawait new Promise(() => {});\n");

    assert.throws(() => importUnderShellGuard(url, { timeoutMs: 1_000 }), /timed out after 1000ms/);
  });
});
