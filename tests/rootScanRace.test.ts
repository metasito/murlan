// tests/rootScanRace.test.ts — #999: a test that lists the repo root must not
// read what it listed. `tests/checkStrictIndexed.test.ts` writes and deletes
// `scratch.strictIndexed.*.json` there — it has to, because a tsconfig's
// `include` globs resolve relative to its own directory — and under
// `node --test`'s parallel file execution another file's listing and that
// cleanup interleave. It reddened `main` once already.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedRootFiles } from "./helpers/trackedFiles.ts";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "tests/rootScanRace.test.ts";

/** What a root scan must not be. */
const ROOT_READDIR = /readdirSync\(\s*(?:repoRoot|REPO_ROOT)\b/;

/** The scan this ticket replaces, kept so the counterfactual below can run it. */
const OLD_WAY = (): string[] =>
  readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

/**
 * The two declarations above, as they are written here. Blanked in this file
 * only: the guard has to spell the pattern out and has to keep one working
 * copy of it, and exempting the whole file instead would exempt the guard.
 */
const SELF_EXEMPT = [/const ROOT_READDIR =[\s\S]*?;/, /const OLD_WAY =[\s\S]*?;/];

function source(rel: string): string {
  const text = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
  return rel === SELF ? SELF_EXEMPT.reduce((s, re) => s.replace(re, ""), text) : text;
}

/**
 * The race, made deterministic: no timing, just the two halves in order. A
 * listing taken while an untracked file exists, read after it is gone.
 */
function scanAcrossAVanishingFile(list: () => string[]): void {
  const scratch = path.join(repoRoot, "scratch.rootScanRace.json");
  writeFileSync(scratch, "{}");
  let listed: string[];
  try {
    listed = list();
  } finally {
    rmSync(scratch, { force: true });
  }
  for (const name of listed) readFileSync(path.join(repoRoot, name), "utf8");
}

describe("a root-level scan survives a file appearing and vanishing mid-scan", () => {
  // The counterfactual, first: without it, a green below could mean the helper
  // works or could mean this machine never had the race to begin with.
  test("readdirSync of the root is the thing that fails", () => {
    assert.throws(
      () => scanAcrossAVanishingFile(OLD_WAY),
      /ENOENT[\s\S]*scratch\.rootScanRace\.json/
    );
  });

  test("trackedRootFiles never lists a file git does not track", () => {
    assert.doesNotThrow(() => scanAcrossAVanishingFile(() => trackedRootFiles(repoRoot)));
  });

  test("every root file it does list is one git tracks", () => {
    const tracked = new Set(
      execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
        .split("\0")
        .filter(Boolean)
    );
    const stray = trackedRootFiles(repoRoot).filter((name) => !tracked.has(name));
    assert.deepEqual(stray, [], `${stray.join(", ")} came from somewhere other than git ls-files`);
  });
});

describe("no test lists the repo root from the filesystem", () => {
  test("every root scan goes through trackedRootFiles", () => {
    const files = execFileSync("git", ["ls-files", "-z", "tests", "scripts"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\0")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".mjs"));
    const offenders = files.filter((f) => ROOT_READDIR.test(source(f)));
    assert.deepEqual(
      offenders,
      [],
      `${offenders.join(", ")} lists the repo root from the filesystem, so a scratch file another ` +
        "test writes there can be listed and then read after it is gone. Use " +
        "`trackedRootFiles(repoRoot)` from tests/helpers/trackedFiles.ts."
    );
  });
});
