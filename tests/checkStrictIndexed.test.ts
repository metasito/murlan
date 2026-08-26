// tests/checkStrictIndexed.test.ts — the noUncheckedIndexedAccess ratchet
// (tsconfig.strictIndexed.json + scripts/checkStrictIndexed.mjs) can only
// ever be as strong as its floor. An include list that matches nothing
// typechecks clean, and that is indistinguishable from a real pass unless
// something asserts it is not one — the self-defeating safeguard CLAUDE.md
// forbids.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, areasOf, runStrictIndexedCheck } from "../scripts/checkStrictIndexed.mjs";

// tsconfig `include` globs resolve relative to the config file's own
// directory, so a scratch config has to live inside the repo — an OS temp
// dir would resolve every include pattern against itself instead.
function scratchConfig(name: string, contents: object): string {
  const configPath = path.join(REPO_ROOT, name);
  writeFileSync(configPath, JSON.stringify({ extends: "./tsconfig.json", ...contents }));
  return configPath;
}

describe("noUncheckedIndexedAccess ratchet", () => {
  test("areasOf reads the top-level directory off each include glob", () => {
    assert.deepEqual(areasOf({ include: ["server/**/*.ts", "context/**/*.tsx"] }), [
      "server",
      "context",
    ]);
    assert.deepEqual(areasOf({ include: [] }), []);
    assert.deepEqual(areasOf({}), []);
  });

  test("the real config passes today", () => {
    const { ok, message } = runStrictIndexedCheck();
    assert.equal(ok, true, message);
  });

  // Floor, part two: an empty include list must fail, not pass vacuously.
  test("fails when the include list is empty", () => {
    const configPath = scratchConfig("scratch.strictIndexed.empty.json", {
      compilerOptions: { noUncheckedIndexedAccess: true },
      include: [],
    });
    try {
      const { ok, message } = runStrictIndexedCheck(configPath);
      assert.equal(ok, false);
      assert.match(message, /include list is empty/);
    } finally {
      rmSync(configPath, { force: true });
    }
  });

  // Floor, part two: an include list that names no real files — a moved or
  // misspelled area — must fail the same way an empty list does.
  test("fails when an include area matches no files", () => {
    const configPath = scratchConfig("scratch.strictIndexed.noMatch.json", {
      compilerOptions: { noUncheckedIndexedAccess: true },
      include: ["nowhere-under-this-repo/**/*.ts"],
    });
    try {
      const { ok, message } = runStrictIndexedCheck(configPath);
      assert.equal(ok, false);
      assert.match(message, /matched no files/);
    } finally {
      rmSync(configPath, { force: true });
    }
  });

  // Floor, part two: a deliberately-added unchecked index in a ratcheted
  // area must fail the check, not slip past it.
  test("fails on a fresh unchecked index in an area it covers", () => {
    const fixtureName = "scratch-strict-indexed-fixture";
    const fixtureDir = path.join(REPO_ROOT, fixtureName);
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      path.join(fixtureDir, "unchecked.ts"),
      "export function readFirst(xs: number[]): number {\n  return xs[0] + 1;\n}\n"
    );
    const configPath = scratchConfig("scratch.strictIndexed.newViolation.json", {
      compilerOptions: { noUncheckedIndexedAccess: true },
      include: [`${fixtureName}/**/*.ts`],
    });
    try {
      const { ok, message } = runStrictIndexedCheck(configPath);
      assert.equal(ok, false);
      assert.match(message, /unchecked\.ts/);
      assert.match(message, /noUncheckedIndexedAccess error/);
    } finally {
      rmSync(configPath, { force: true });
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
