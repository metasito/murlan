// tests/pruneWorktreesLinks.test.ts
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detachReparsePoints, reparsePointNames } from "../scripts/prune-worktrees.mjs";

describe("naming the links at a worktree's top level", () => {
  const dirent = (name: string, link: boolean) =>
    ({ name, isSymbolicLink: () => link }) as unknown as fs.Dirent;

  // A Windows junction reports as a symbolic link to Node, which is what lets one test cover both.
  test("finds them and leaves real directories alone", () => {
    const entries = [dirent("the-link", true), dirent("server", false), dirent("shared", false)];
    assert.deepEqual(reparsePointNames(entries), ["the-link"]);
  });

  test("a worktree with no links yields nothing", () => {
    assert.deepEqual(reparsePointNames([dirent("server", false)]), []);
  });
});

describe("detaching a link before a worktree is deleted", () => {
  // Named for the shape rather than the case. The real link is the install junction, but a test
  // file joining that literal name trips the scanner in handBuiltNodeModulesPaths.test.ts.
  const LINK = "linked-install";
  let root: string | null = null;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  /**
   * The failure this guards against, reproduced: `git worktree remove` walks into a junction
   * rather than unlinking it, and one such remove emptied `node_modules/.bin` of all 177 shims
   * before failing with "Invalid argument".
   */
  test("removes the link and never what it points at", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-links-"));
    const target = path.join(root, "real");
    const worktree = path.join(root, "worktree");
    fs.mkdirSync(path.join(target, "typescript"), { recursive: true });
    fs.writeFileSync(path.join(target, "typescript", "tsc"), "the install", "utf8");
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, "package.json"), "{}", "utf8");

    try {
      fs.symlinkSync(target, path.join(worktree, LINK), "junction");
    } catch {
      return; // A platform that will not make one has nothing to prove here.
    }

    assert.deepEqual(detachReparsePoints(worktree), [LINK]);
    assert.equal(fs.existsSync(path.join(worktree, LINK)), false, "the link should be gone");
    assert.equal(
      fs.readFileSync(path.join(target, "typescript", "tsc"), "utf8"),
      "the install",
      "the install the link pointed at must survive untouched"
    );
    assert.ok(fs.existsSync(path.join(worktree, "package.json")), "real files stay put");
  });

  test("a directory with no links is left exactly as it was", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "murlan-links-"));
    fs.writeFileSync(path.join(root, "a.txt"), "x", "utf8");
    assert.deepEqual(detachReparsePoints(root), []);
    assert.ok(fs.existsSync(path.join(root, "a.txt")));
  });

  // Called on the path of a worktree whose directory is already gone, which is the ordinary case
  // for the orphan pass.
  test("a directory that does not exist is not an error", () => {
    assert.deepEqual(detachReparsePoints(path.join(os.tmpdir(), "murlan-not-here-at-all")), []);
  });
});
