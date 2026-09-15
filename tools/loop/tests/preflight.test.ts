// tools/loop/tests/preflight.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyStatus, primaryWorktree, lockDrift, checkLockDrift } from "../preflight.mjs";
import { FOUND_NOTHING, IF_FOUND } from "../loop-derive.mjs";

describe("what blocks a run from starting", () => {
  test("a modified tracked file blocks", () => {
    const { blocking } = classifyStatus(" M .claude/workflows/ticket-pipeline.mjs");
    assert.deepEqual(blocking, ["M .claude/workflows/ticket-pipeline.mjs"]);
  });

  test("staged, deleted and renamed files block too", () => {
    const { blocking } = classifyStatus("M  a.ts\n D b.ts\nR  c.ts -> d.ts");
    assert.equal(blocking.length, 3);
  });

  // A scratch folder is not someone's in-flight change, and a check that blocks on one becomes a
  // check people skip.
  test("untracked paths are reported but never block", () => {
    const { blocking, untracked } = classifyStatus('?? "murlan bug/"\n?? scratch.txt');
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, ['"murlan bug/"', "scratch.txt"]);
  });

  // The floor: on a clean tree the check must find nothing. One that always reports something
  // would satisfy every assertion above and block every run.
  test("a clean tree blocks nothing and reports nothing", () => {
    const { blocking, untracked } = classifyStatus("");
    assert.deepEqual(blocking, []);
    assert.deepEqual(untracked, []);
  });

  test("the primary worktree is the first one git prints", () => {
    const listing = [
      "worktree C:/Users/dev/murlan",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree C:/Users/dev/murlan/.worktrees/agent-42",
      "HEAD def",
    ].join("\n");
    assert.equal(primaryWorktree(listing), "C:/Users/dev/murlan");
  });

  test("an unreadable listing yields no worktree rather than a wrong one", () => {
    assert.equal(primaryWorktree(""), null);
  });
});

describe("node_modules drift from package-lock.json", () => {
  const packageJson = { dependencies: { "react-native": "0.86.3" }, devDependencies: { typescript: "5.0.0" } };
  const packageLock = {
    packages: {
      "node_modules/react-native": { version: "0.86.3" },
      "node_modules/typescript": { version: "5.0.0" },
    },
  };

  test("an installed version behind the lockfile is drift", () => {
    const drift = lockDrift(packageJson, packageLock, { "react-native": "0.81.5", typescript: "5.0.0" });
    assert.deepEqual(drift, [{ name: "react-native", installed: "0.81.5", locked: "0.86.3" }]);
  });

  test("a missing install is drift too, not silently skipped", () => {
    const drift = lockDrift(packageJson, packageLock, { typescript: "5.0.0" });
    assert.deepEqual(drift, [{ name: "react-native", installed: "missing", locked: "0.86.3" }]);
  });

  test("matching installs report no drift", () => {
    const drift = lockDrift(packageJson, packageLock, { "react-native": "0.86.3", typescript: "5.0.0" });
    assert.deepEqual(drift, []);
  });

  test("a dependency absent from the lockfile's packages map is not checked", () => {
    const drift = lockDrift(
      { dependencies: { unlocked: "1.0.0" } },
      { packages: {} },
      { unlocked: "2.0.0" }
    );
    assert.deepEqual(drift, []);
  });
});

describe("checkLockDrift reads a real root, not just in-memory objects", () => {
  function root() {
    const dir = mkdtempSync(join(tmpdir(), "preflight-drift-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { widget: "2.0.0" } }));
    return dir;
  }

  function install(dir: string, version: string) {
    const pkgDir = join(dir, "node_modules", "widget");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version }));
  }

  test("an on-disk install behind the lockfile is drift", () => {
    const dir = root();
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/widget": { version: "2.0.0" } } })
    );
    install(dir, "1.0.0");
    try {
      assert.deepEqual(checkLockDrift(dir), [{ name: "widget", installed: "1.0.0", locked: "2.0.0" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A lockfile with no `packages` map can't be compared against at all — reporting "clean"
  // would be the safeguard passing without checking anything.
  test("a lockfile with no packages map throws rather than reporting clean", () => {
    const dir = root();
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({}));
    install(dir, "2.0.0");
    try {
      assert.throws(() => checkLockDrift(dir), /packages/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Real dependencies of this repo (helmet, drizzle-orm, ...) ship an `exports` map that omits
  // `./package.json`; `require.resolve("widget/package.json")` would throw for this fixture the
  // same way it does for them, and reads as "missing" rather than the version actually on disk.
  test("an exports map that omits package.json is still read correctly", () => {
    const dir = root();
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/widget": { version: "2.0.0" } } })
    );
    const pkgDir = join(dir, "node_modules", "widget");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "widget", version: "2.0.0", exports: { ".": "./index.js" } })
    );
    writeFileSync(join(pkgDir, "index.js"), "module.exports = {};");
    try {
      assert.deepEqual(checkLockDrift(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the --if-found answer", () => {
  const cleanCheckout = (t: { after: (fn: () => void) => void }) => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-clean-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env });
    git("init", "-b", "main");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "1.0.0" }));
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ name: "t", packages: {} }));
    git("add", "-A");
    git("commit", "-m", "init", "--no-gpg-sign");
    return dir;
  };
  const spawn = (dir: string, args: string[]) =>
    spawnSync(process.execPath, [fileURLToPath(new URL("../preflight.mjs", import.meta.url)), ...args], {
      cwd: dir,
      encoding: "utf8",
    });

  test("a clean checkout still exits 0 and says so when nobody asked", (t) => {
    const done = spawn(cleanCheckout(t), []);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /is clean/);
  });

  test("and answers FOUND_NOTHING when asked, so queue-pre can drop its row", (t) => {
    assert.equal(spawn(cleanCheckout(t), [IF_FOUND]).status, FOUND_NOTHING);
  });
});
