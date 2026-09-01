import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignShards,
  filesForShard,
  isInvokedDirectly,
  readTimings,
  specFilesIn,
  UNMEASURED_SECONDS,
} from "../scripts/e2e-shard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DIR = path.join(repoRoot, "tests", "e2e");
/** Kept in step with .github/workflows/ci.yml's `shard:` matrix. */
const SHARDS = 6;

/**
 * How much of the suite may sit at `UNMEASURED_SECONDS` before the evenness
 * assertion below stops being about time. Room for a spec or two written since
 * the last measurement, and nowhere near enough for the constant to carry the
 * split.
 */
const UNMEASURED_SHARE = 0.1;

describe("every browser spec reaches exactly one shard", () => {
  test("the union of the shards is the whole suite, with nothing repeated", () => {
    const files = specFilesIn(E2E_DIR);
    const assigned = assignShards(files, readTimings(), SHARDS).flatMap((s) => s.files);

    assert.deepEqual([...assigned].sort(), [...files].sort());
    assert.equal(new Set(assigned).size, assigned.length, "a spec is in two shards");
  });

  test("a spec nobody has measured is still placed", () => {
    // The failure this exists for: a new spec is added, no one updates
    // timings.json, and the suite quietly stops covering it.
    const files = [...specFilesIn(E2E_DIR), "brandNew.spec.ts"];
    const assigned = assignShards(files, readTimings(), SHARDS).flatMap((s) => s.files);

    assert.ok(assigned.includes("brandNew.spec.ts"));
  });

  test("an unmeasured spec is assumed slow, not free", () => {
    const [heavy] = assignShards(["a.spec.ts"], {}, 1);

    assert.equal(heavy.seconds, UNMEASURED_SECONDS);
  });

  test("webPerf is left out, as playwright.config.ts also ignores it", () => {
    assert.ok(
      readdirSync(E2E_DIR).includes("webPerf.spec.ts"),
      "this test is pinning an exclusion that no longer has anything to exclude"
    );
    assert.ok(!specFilesIn(E2E_DIR).includes("webPerf.spec.ts"));
  });
});

describe("the split is stable and even", () => {
  test("the same suite always splits the same way", () => {
    const once = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS);
    const twice = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS);

    assert.deepEqual(once, twice);
  });

  test("no shard carries more than a third again of the lightest", () => {
    // The defect #441 was filed over was a 2m11s shard and a 5m20s shard in
    // the same run. Longest-processing-time guarantees far better than this;
    // the margin is here so a pathological timings.json still fails loudly.
    const seconds = assignShards(specFilesIn(E2E_DIR), readTimings(), SHARDS).map((s) => s.seconds);

    assert.ok(
      Math.max(...seconds) <= Math.min(...seconds) * (4 / 3),
      `shards range ${Math.min(...seconds)}s to ${Math.max(...seconds)}s`
    );
  });

  test("the evenness above is measured, not assumed", () => {
    // What the assertion above compares is `UNMEASURED_SECONDS` per unmeasured
    // spec, and a constant divides evenly: the less of the suite is measured,
    // the more even the split looks. At 22 of 47 unmeasured it read a flat 331s
    // across six shards that really ran 119s to 226s, and #441's defect was
    // back with its own guard reporting it fixed. Counted rather than weighed,
    // because weighing needs the very seconds that are missing.
    const files = specFilesIn(E2E_DIR);
    const timings = readTimings();
    const guessed = files.filter((file) => !(file in timings));

    assert.ok(
      guessed.length <= files.length * UNMEASURED_SHARE,
      `${guessed.length} of ${files.length} specs are priced at the ${UNMEASURED_SECONDS}s ` +
        `guess, over the ${UNMEASURED_SHARE * 100}% the split can absorb and still be even in ` +
        `wall clock: ${guessed.join(", ")}. scripts/e2e-timings.mjs regenerates the file from a ` +
        `CI run's own reports, and says at the top where to get one.`
    );
  });

  test("timings.json describes specs that exist", () => {
    const known = specFilesIn(E2E_DIR);
    const stale = Object.keys(readTimings()).filter((f) => !known.includes(f));

    assert.deepEqual(stale, [], "timings.json names specs that are gone");
  });
});

describe("the shard argument", () => {
  test("names each shard exactly once across 1..n", () => {
    const all = Array.from({ length: SHARDS }, (_, i) => filesForShard(i + 1, SHARDS)).flat();

    assert.deepEqual([...all].sort(), [...specFilesIn(E2E_DIR)].sort());
  });

  test("refuses an index outside the run", () => {
    assert.throws(() => filesForShard(0, SHARDS), /shard index/);
    assert.throws(() => filesForShard(SHARDS + 1, SHARDS), /shard index/);
    assert.throws(() => assignShards([], {}, 0), /positive integer/);
  });

  test("importing the module never runs the CLI body", () => {
    const self = path.join(repoRoot, "scripts", "e2e-shard.mjs");

    assert.equal(isInvokedDirectly(undefined, `file:///${self}`), false);
    assert.equal(isInvokedDirectly(path.join(repoRoot, "scripts", "other.mjs"), "file:///x"), false);
  });
});
