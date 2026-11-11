import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assign, commandFor, lanesOf, listing, makespan, TEST_GLOB } from "../../tools/ci/verify-shard.mjs";
import { SUITES } from "../../tools/ci/test-verdict.mjs";
import { loadWorkflow } from "../helpers/workflow.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const script: string = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.test;
const verify = loadWorkflow("ci.yml").jobs.verify!;
const SHARDS = verify.strategy?.matrix?.shard as number[];

describe("every file npm test runs reaches exactly one verify shard", () => {
  test("the listing is the one CI gate's verdict holds the shards to", () => {
    const tracked = execFileSync("git", ["ls-files", "tests"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    const judged = tracked.filter(SUITES.find((s) => s.name === "npm test")!.lists).sort();
    assert.ok(judged.length >= 400, `only ${judged.length} files listed`);
    assert.deepEqual(listing(root), judged);
  });

  test("each file of the listing lands in one shard, measured or not", () => {
    const files = listing(root);
    const seconds = Object.fromEntries(files.filter((_, i) => i % 3).map((f, i) => [f, (i * 7919) % 97]));
    const shards = assign(files, seconds, SHARDS.length, lanesOf(script));
    assert.equal(shards.length, SHARDS.length);
    assert.ok(shards.every((s) => s.length > 0), "a shard got no files");
    assert.deepEqual(shards.flat().sort(), files);
  });
});

describe("the split evens wall clock, not seconds", () => {
  test("a long file that sorts last is kept off a shard that would start it last", () => {
    // Two lanes a shard. Splitting the seconds evenly puts d and f beside z, which sorts after
    // them and starts only once they finish: 40 s. Alone beside e, z starts at once: 30 s.
    const seconds = { a: 10, b: 10, c: 10, d: 10, e: 10, f: 10, z: 30 };
    const shards = assign(Object.keys(seconds), seconds, 2, 2);
    const cost = (f: string) => seconds[f as keyof typeof seconds];
    assert.equal(makespan(["d", "f", "z"], cost, 2), 40);
    assert.equal(Math.max(...shards.map((s) => makespan(s, cost, 2))), 30, JSON.stringify(shards));
  });

  test("the model starts files in sorted order, lanes at a time", () => {
    assert.equal(makespan(["z", "a"], (f) => (f === "z" ? 5 : 1), 1), 6);
    assert.equal(makespan(["b", "a", "c"], () => 2, 2), 4);
  });

  test("the lanes are the test script's own concurrency", () => {
    assert.match(script, /--test-concurrency=\d+/);
    assert.equal(lanesOf(script), Number(/--test-concurrency=(\d+)/.exec(script)![1]));
  });
});

describe("a shard runs npm test's own command", () => {
  test("the glob is swapped for the shard's files and nothing else changes", () => {
    const files = ["a", "b"];
    const words = script.split(/\s+/);
    assert.deepEqual(commandFor(script, files), words.flatMap((w) => (w === TEST_GLOB ? files : [w])));
    assert.throws(() => commandFor(script.replace(TEST_GLOB, '"tests/**/*.spec.ts"'), files), /no longer names/);
    assert.throws(() => commandFor(`${script} && echo`, files), /without a shell/);
    assert.throws(() => commandFor(script, []), /no files/);
  });

  test("ci.yml shards verify by this planner, from the timings the scope job settled", () => {
    const yml = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    assert.ok(Array.isArray(SHARDS) && SHARDS.length >= 2, "verify's matrix is not a literal list of shards");
    assert.deepEqual(SHARDS, SHARDS.map((_, i) => i + 1));
    assert.match(yml, /node tools\/ci\/verify-shard\.mjs run \$\{\{ matrix\.shard \}\} \$\{\{ strategy\.job-total \}\} /);
    assert.match(yml, /verify-timings: \$\{\{ steps\.verify-plan\.outputs\.verify-timings \}\}/);
    assert.match(yml, /node tools\/ci\/verify-shard\.mjs plan /);
    assert.ok(!verify.steps!.some((s) => /\bnpm test\b/.test(s.run ?? "")), "a verify step still runs the whole suite");
  });
});
