// tests/entry.test.ts — the one answer to "was this file run, or imported?"
//
// In the game's suite rather than the loop's because `scripts/lib/entry.mjs` is shared: twelve
// scripts under `scripts/` import it against nine under `tools/loop/`, and a change to it sets
// app=true.
//
// Two of the shapes it replaced were wrong in ways that only show up under a real invocation: a
// bare suffix match says yes to any same-named file anywhere on disk, and a comparison that never
// resolves the path says no to the ordinary `node scripts/x.mjs` relative invocation. Both cases
// are pinned here directly, once, rather than once per caller.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isInvokedDirectly } from "../scripts/lib/entry.mjs";

describe("isInvokedDirectly", () => {
  const self = path.resolve("scripts/lib/entry.mjs");
  const moduleUrl = pathToFileURL(self).href;

  test("an absolute argv1 matching the module's own path", () => {
    assert.equal(isInvokedDirectly(self, moduleUrl), true);
  });

  test("a relative argv1 that resolves to the same file", () => {
    const relative = path.relative(process.cwd(), self);
    assert.equal(isInvokedDirectly(relative, moduleUrl), true);
  });

  test("a same-basename file in a different directory is not a match", () => {
    const decoy = path.join(path.dirname(self), "..", "entry.mjs");
    assert.equal(isInvokedDirectly(decoy, moduleUrl), false);
  });

  test("undefined argv1 — importing the module, not running it", () => {
    assert.equal(isInvokedDirectly(undefined, moduleUrl), false);
  });

  test("empty-string argv1", () => {
    assert.equal(isInvokedDirectly("", moduleUrl), false);
  });

  test("a malformed module URL returns false rather than throwing", () => {
    assert.doesNotThrow(() => isInvokedDirectly(self, "not a url"));
    assert.equal(isInvokedDirectly(self, "not a url"), false);
  });
});
