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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "tests/rootScanRace.test.ts";

/** A directory listing of somewhere named like a repo root, however spelt. */
const ROOT_READDIR =
  /(?:readdirSync|opendirSync|readdir|opendir)\(\s*\w*(?:[Rr]oot|ROOT)(?:Dir|_DIR|Path|_PATH)?\s*[,)]/;

/**
 * Every spelling this file has to hold, on both sides. One `planted` sample
 * per alternative of the pattern, so an empty offender list means the scan
 * looked; `clean` is what must not red, because a guard that reds on a
 * subdirectory listing is a guard someone deletes.
 */
const SAMPLES = {
  planted: [
    "readdirSync(repoRoot)",
    "readdirSync(REPO_ROOT, { withFileTypes: true })",
    "readdirSync(ROOT)",
    "readdirSync(ROOT_DIR, { recursive: true })",
    "opendirSync(rootDir)",
    "await readdir(projectRoot)",
    "await opendir(ROOT)",
  ],
  clean: [
    'readdirSync(path.join(repoRoot, "scripts"))',
    "readdirSync(dir, { recursive: true })",
    "readdirSync(roots)",
    "readdirSync(rootedAt)",
  ],
  lines: ["// readdirSync(repoRoot)", " * readdirSync(ROOT)", "readdirSync(repoRoot);"],
};

/**
 * The two declarations above, blanked in this file only: the guard has to
 * spell the pattern out and hold a sample of each spelling, and exempting the
 * whole file would exempt the guard.
 */
const SELF_EXEMPT = [/const ROOT_READDIR =[\s\S]*?;/, /const SAMPLES = \{[\s\S]*?\n\};/];

/** A comment line, including a block comment's opener and its continuations. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Comment lines dropped, nothing else touched. Not `blankComments`: its
 * `/\*` … `*\/` pass starts at a `/*` inside a string or a regex literal and
 * runs to the next `*\/`, which over `scripts/loop-status.mjs` deletes 45
 * lines of live code (#1015). A scan whose input can vanish reports clean.
 */
function source(rel: string): string {
  const text = readFileSync(path.join(repoRoot, rel), "utf8")
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
  return rel === SELF
    ? SELF_EXEMPT.reduce((s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, " ")), text)
    : text;
}

/** The scan this replaces, as it was written, so the counterfactual can run it. */
const listFromDisk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

/** A throwaway repo with one tracked file, so nothing here writes to this one. */
function withTempRepo(body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "root-scan-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(path.join(dir, "tracked.json"), "{}");
    // The index is what `git ls-files` reads; a commit would add nothing.
    git("add", "--", "tracked.json");
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    withTempRepo((dir) =>
      assert.throws(
        () => scanAcrossAVanishingFile(dir, listFromDisk),
        /ENOENT[\s\S]*scratch\.vanishing\.json/
      )
    );
  });

  test("trackedRootFiles never lists a file git does not track", () => {
    withTempRepo((dir) => {
      assert.deepEqual(trackedRootFiles(dir), ["tracked.json"]);
      assert.doesNotThrow(() => scanAcrossAVanishingFile(dir, trackedRootFiles));
    });
  });

  test("this repo's own root listing is readable, name by name", () => {
    const roots = trackedRootFiles(repoRoot);
    assert.ok(roots.includes("package.json"), `no package.json in ${roots.join(", ")}`);
    for (const name of roots) readFileSync(path.join(repoRoot, name), "utf8");
  });
});

describe("no test lists the repo root from the filesystem", () => {
  test("the pattern catches a root listing under any of its spellings", () => {
    for (const planted of SAMPLES.planted) {
      assert.ok(ROOT_READDIR.test(planted), `${planted} slipped past ROOT_READDIR`);
    }
    // The tax is the name: a local holding a subdirectory must not be called
    // `root`, which is why `tests/i18n.test.ts` calls its `base`.
    for (const clean of SAMPLES.clean) {
      assert.ok(!ROOT_READDIR.test(clean), `${clean} is not a root listing`);
    }
  });

  test("a comment is not code, and code is not a comment", () => {
    assert.deepEqual(SAMPLES.lines.map((l) => COMMENT_LINE.test(l)), [true, true, false]);
  });

  // The scan reads call sites, so a listing reached through a helper —
  // `scripts/contextSurface.mjs`'s `walk(ROOT)` — is invisible to it. That one
  // is a hand-run CLI, never concurrent with `node --test`, so it has no race.
  test("every root scan goes through trackedRootFiles", () => {
    const files = trackedFiles(repoRoot, "tests", "scripts").filter((f) =>
      /\.(?:ts|tsx|mjs|cjs|js)$/.test(f)
    );
    // Three floors: that the scan reached both trees, that the exemption above
    // is an exemption rather than a no-op, and that dropping comment lines left
    // this file's real code behind. Any one of them failing passes everything.
    assert.ok(files.includes(SELF) && files.some((f) => f.startsWith("scripts/")), "scan is empty");
    assert.match(readFileSync(path.join(repoRoot, SELF), "utf8"), ROOT_READDIR);
    assert.doesNotMatch(source(SELF), ROOT_READDIR);
    assert.match(source(SELF), /readdirSync\(dir/);

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
