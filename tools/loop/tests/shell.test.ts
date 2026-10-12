import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { located, MOVES, operands, toNative } from "../shell.mjs";

describe("an MSYS path is the Windows path it names", () => {
  test("a drive is mapped on win32 only", () => {
    assert.equal(toNative("/c/Users/r/repo/a.ts", "win32"), "C:/Users/r/repo/a.ts");
    assert.equal(toNative("/d", "win32"), "D:/");
    assert.equal(toNative("/c/Users/r/repo/a.ts", "linux"), "/c/Users/r/repo/a.ts");
    assert.equal(toNative("/cd/a.ts", "win32"), "/cd/a.ts");
    assert.equal(toNative("c/a.ts", "win32"), "c/a.ts");
  });

  test("Git Bash's /tmp is the OS temp dir on win32", () => {
    assert.equal(toNative("/tmp/v.md", "win32"), `${os.tmpdir().replace(/\\/g, "/")}/v.md`);
    assert.equal(toNative("/tmpfile", "win32"), "/tmpfile");
    assert.equal(toNative("/tmp/v.md", "linux"), "/tmp/v.md");
  });
});

describe("operands", () => {
  test("skip flags, and the value of a flag that takes one", () => {
    assert.deepEqual(operands(["-u", "origin", "--push-option", "ci.skip", "HEAD:agent/1-x"], /^(-o|--push-option)$/), ["origin", "HEAD:agent/1-x"]);
    assert.deepEqual(operands(["--force-with-lease=x", "origin"], /^-o$/), ["origin"]);
    assert.deepEqual(operands(["-o"], /^-o$/), []);
  });
});

describe("a cd moves where the rest of the line runs", () => {
  test("every spelling of a move is one list", () => {
    for (const cmd of ["cd", "chdir", "pushd", "popd", "set-location", "sl", "push-location"]) assert.match(cmd, MOVES);
  });

  test("a command after a cd is located in the cd's directory, and the cd itself is no command", () => {
    const at = located("cd wt && cat a.ts; popd; git status", "/r").map(({ c, at }) => [c.cmd, at]);
    assert.deepEqual(at, [
      ["cat", path.resolve("/r", "wt")],
      ["git", path.resolve("/r", "wt")],
    ]);
  });
});
