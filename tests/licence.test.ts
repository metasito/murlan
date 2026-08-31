// tests/licence.test.ts — the missing LICENSE is a decision, and stays legible as one.
//
// A public repository with no `LICENSE` reads as an oversight, and the obvious
// tidy-up is to add MIT. #297 decided the opposite: all rights reserved, read
// it and write your own. Nothing in the tree said so, which is exactly how a
// default gets mistaken for a gap and "fixed".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolved from this file, never from the cwd: a cwd-relative `existsSync`
// passes from any directory that happens not to hold a licence, which is every
// directory but one.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(repoRoot, "README.md");

/**
 * Anything GitHub would read as a licence, rather than a list of the three
 * spellings that came to mind. `LICENCE` is the likeliest of all here — it is
 * the spelling this repository uses in its own prose — and CI is Linux, where
 * a lowercase `license` is a different file again.
 */
const LICENCE_LIKE = /^(licen[cs]e|copying)(\.|$)/i;

describe("the licence position", () => {
  test("there is no licence file, under any spelling", () => {
    assert.deepEqual(
      readdirSync(repoRoot).filter((name) => LICENCE_LIKE.test(name)),
      [],
      "a licence file appeared. #297 decided this source is not licensed for reuse — if that " +
        "changed, the decision goes on #297 and README.md's own statement changes with it"
    );
  });

  test("README.md says so, so the silence is not the only evidence", () => {
    const readme = readFileSync(README, "utf8");
    assert.match(
      readme,
      /not licensed for reuse/i,
      `${README} no longer states the licence position; without it the absent LICENSE is ` +
        "indistinguishable from an oversight"
    );
    assert.match(
      readme,
      /pull requests are not accepted/i,
      `${README} no longer says whether outside contributions are taken, which is the half a ` +
        "reader actually needs"
    );
  });
});
