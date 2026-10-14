// tools/loop/tests/lockDrift.test.ts
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockDrift, checkLockDrift } from "../workspace.mjs";
import { syncCheckout } from "../queue-loop.mjs";

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
    const dir = mkdtempSync(join(tmpdir(), "lock-drift-"));
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

describe("syncCheckout's reinstall, against the lockfile npm last installed from", () => {
  // On disk, as npm leaves it: `npm ci` writes node_modules/.package-lock.json after the lockfile it read.
  test("a fast-forward that rewrites the lockfile reinstalls; the same tree twice does not", () => {
    const prior = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "loop-lock-"));
    let clock = 1_000_000;
    const lockfile = (content: string) => {
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: {}, content }));
      clock += 10;
      utimesSync(join(dir, "package-lock.json"), clock, clock);
    };
    const reinstall = mock.fn(() => {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");
      utimesSync(join(dir, "node_modules", ".package-lock.json"), clock + 1, clock + 1);
      return "";
    });
    let next: string | null = null;
    const git = (...args: string[]) => {
      if (args[0] === "merge" && next !== null) lockfile(next);
      return ({ "rev-parse": "main" } as Record<string, string>)[args[0]] ?? "";
    };
    try {
      process.chdir(dir);
      writeFileSync("package.json", "{}");
      lockfile("a");
      for (const lock of [null, null, "b", null]) {
        next = lock;
        assert.equal(syncCheckout(git, () => {}, reinstall), true);
      }
      assert.equal(reinstall.mock.calls.length, 2, "the first install, then the rewrite's");
    } finally {
      process.chdir(prior);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
