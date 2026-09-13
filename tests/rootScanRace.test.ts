// tests/rootScanRace.test.ts — no test lists the repo root from the filesystem.
//
// The reason is in tests/helpers/trackedFiles.ts; this file is the guard.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, trackedRootFiles } from "./helpers/trackedFiles.ts";
import { blankCommentsAndStrings } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "tests/rootScanRace.test.ts";

/** A directory listing of somewhere named like a repo root, however spelt. */
const ROOT_READDIR = /(?:readdirSync|opendirSync|readdir)\(\s*\w*(?:[Rr]oot|ROOT)\b/;

/** The scan this replaces, as it was written, so the counterfactual can run it. */
const listFromDisk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

/** A throwaway repo with one tracked file, so nothing here writes to this one. */
function tempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "root-scan-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(path.join(dir, "tracked.json"), "{}");
  // The index is what `git ls-files` reads; a commit would add nothing.
  git("add", "--", "tracked.json");
  return dir;
}

/**
 * The race, made deterministic: no timing, just the two halves in order. A
 * listing taken while an untracked file exists, read after it is gone.
 */
function scanAcrossAVanishingFile(dir: string, list: (d: string) => string[]): void {
  const scratch = path.join(dir, "scratch.vanishing.json");
  writeFileSync(scratch, "{}");
  let listed: string[];
  try {
    listed = list(dir);
  } finally {
    rmSync(scratch, { force: true });
  }
  for (const name of listed) readFileSync(path.join(dir, name), "utf8");
}

describe("a root-level scan survives a file appearing and vanishing mid-scan", () => {
  // The counterfactual, first: without it a green below could mean the helper
  // works, or could mean the fixture never had the race to begin with.
  test("a filesystem listing is the thing that fails", () => {
    const dir = tempRepo();
    try {
      assert.throws(
        () => scanAcrossAVanishingFile(dir, listFromDisk),
        /ENOENT[\s\S]*scratch\.vanishing\.json/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("trackedRootFiles never lists a file git does not track", () => {
    const dir = tempRepo();
    try {
      assert.deepEqual(trackedRootFiles(dir), ["tracked.json"]);
      assert.doesNotThrow(() => scanAcrossAVanishingFile(dir, trackedRootFiles));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("this repo's own root listing is readable, name by name", () => {
    const roots = trackedRootFiles(repoRoot);
    assert.ok(roots.includes("package.json"), `no package.json in ${roots.join(", ")}`);
    for (const name of roots) readFileSync(path.join(repoRoot, name), "utf8");
  });
});

describe("no test lists the repo root from the filesystem", () => {
  // Planted defects, so an empty offender list below means nobody does it
  // rather than that the pattern stopped matching.
  test("the pattern catches a root listing under any of its spellings", () => {
    for (const planted of [
      "readdirSync(repoRoot)",
      "readdirSync(REPO_ROOT, { withFileTypes: true })",
      "readdirSync(ROOT)",
      "await readdir(projectRoot)",
    ]) {
      assert.ok(ROOT_READDIR.test(planted), `${planted} slipped past ROOT_READDIR`);
    }
    assert.ok(!ROOT_READDIR.test('readdirSync(path.join(repoRoot, "scripts"))'));
  });

  test("every root scan goes through trackedRootFiles", () => {
    const files = trackedFiles(repoRoot, "tests", "scripts").filter((f) =>
      /\.(?:ts|tsx|mjs|cjs|js)$/.test(f)
    );
    // Two floors under the scan: that it reached both trees, and that blanking
    // left the code it reads behind. Either one empty passes everything.
    assert.ok(files.includes(SELF) && files.some((f) => f.startsWith("scripts/")), "scan is empty");
    assert.match(source(SELF), /readdirSync\(/);

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

/** Strings blanked too: the planted defects above are string literals in this file. */
function source(rel: string): string {
  return blankCommentsAndStrings(readFileSync(path.join(repoRoot, rel), "utf8"));
}
