// tests/bundleBudget.test.ts — the web bundle's size ceiling used to be an
// honour system: #95 chose a visual direction on the promise of staying under
// ~1 MB gzipped, and nothing checked it.
//
// A size gate that has never gone red is indistinguishable from one that always
// passes, so both directions are exercised here, and so is the case that makes
// the whole thing worthless: measuring an empty directory and reporting success.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { BUDGET_BYTES, gzippedJsSize, report } from "../scripts/bundle-budget.mjs";

function tempBundle(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-bundle-"));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

describe("the web bundle's size budget", () => {
  test("fails over budget, and says by how much", () => {
    const { over, message } = report(1_200, 3, 1_000);

    assert.equal(over, true);
    assert.match(message, /over budget/i);
    // The numbers have to be in the message or the failure needs a local rerun.
    assert.match(message, /1\.2 KB/);
    assert.match(message, /1\.0 KB/);
    assert.match(message, /over by:\s+0\.2 KB/);
  });

  test("passes under budget, and says how much room is left", () => {
    const { over, message } = report(800, 3, 1_000);

    assert.equal(over, false);
    assert.match(message, /within budget/i);
    assert.match(message, /headroom:\s+0\.2 KB/);
  });

  test("treats a bundle exactly at budget as within it", () => {
    assert.equal(report(1_000, 1, 1_000).over, false);
  });

  test("measures gzipped bytes, not raw", () => {
    // Wildly compressible, so raw and gzipped cannot be confused for each other.
    const source = "a".repeat(200_000);
    const dir = tempBundle({ "entry-abc.js": source });
    try {
      const { total, files } = gzippedJsSize(dir);

      assert.equal(files, 1);
      assert.equal(total, zlib.gzipSync(Buffer.from(source)).length);
      assert.ok(total < source.length / 10, `expected gzip, got ${total} of ${source.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sums every JS file, and ignores what is not JS", () => {
    const dir = tempBundle({
      "entry-a.js": "x".repeat(50_000),
      "entry-b.js": "y".repeat(50_000),
      "entry-a.js.map": "z".repeat(50_000),
      "index.html": "<!doctype html>",
    });
    try {
      const { files } = gzippedJsSize(dir);
      assert.equal(files, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The floor. Everything above still passes if the gate quietly measures
  // nothing at all, which is the shape this check fails in for real: a moved
  // output path, an earlier build step that did not run.
  test("refuses to pass when there is nothing to measure", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "murlan-bundle-empty-"));
    try {
      assert.throws(() => gzippedJsSize(empty), /nothing was checked/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    const missing = path.join(tmpdir(), "murlan-bundle-does-not-exist-xyz");
    rmSync(missing, { recursive: true, force: true });
    assert.throws(() => gzippedJsSize(missing), /No web bundle/);
  });

  test("the committed budget leaves room over the size that set it", () => {
    // #95 measured 753 KB. A budget at that number fails on the first honest
    // commit and gets raised reflexively.
    assert.ok(BUDGET_BYTES > 753 * 1024, `budget ${BUDGET_BYTES} is not above 753 KB`);
    assert.ok(BUDGET_BYTES <= 1024 * 1024, `budget ${BUDGET_BYTES} exceeds #95's ~1 MB ceiling`);
  });
});
