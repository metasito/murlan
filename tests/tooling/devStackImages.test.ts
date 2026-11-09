import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

type Step = { name?: string; id?: string; uses?: string; if?: string; run?: string; with?: { path?: string; key?: string } };
const root = path.resolve(import.meta.dirname, "..", "..");
const source = readFileSync(path.join(root, "scripts/dev-stack.mjs"), "utf8");
const images = () => execFileSync(process.execPath, [path.join(root, "scripts/dev-stack.mjs"), "images"], { encoding: "utf8" }).trim().split("\n");

test("dev-stack.mjs names the two images it runs, with no docker needed", () => {
  assert.deepEqual(images(), [/^const IMAGE = "([^"]+)";$/m.exec(source)![1], /^const VALKEY_IMAGE = "([^"]+)";$/m.exec(source)![1]]);
});

/** What a shard of the browser job does about the stack's images, as the problems it finds. */
export function imageProblems(steps: Step[]): string[] {
  const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
  const cache = at((s) => /^actions\/cache@/.test(s.uses ?? "") && /dev-stack-images/.test(s.with?.path ?? ""));
  const tests = at((s) => /npm run test:e2e/.test(s.run ?? ""));
  const problems: string[] = [];
  if (cache < 0) return ["no step caches the stack's images, so every shard pulls them from the registry"];
  const cached = steps[cache]!;
  if (!(cached.with?.key ?? "").includes("hashFiles('scripts/dev-stack.mjs')")) problems.push("the cache key does not move with the images dev-stack.mjs names");
  const load = steps.findIndex((s) => /docker load/.test(s.run ?? ""));
  if (load < cache || load > tests || !(steps[load]!.if ?? "").includes(`steps.${cached.id}.outputs.cache-hit == 'true'`)) problems.push("a hit is not loaded before the suite");
  const pull = steps.findIndex((s) => /dev-stack\.mjs pull/.test(s.run ?? ""));
  if (pull < cache || pull > tests || !(steps[pull]!.if ?? "").includes(`steps.${cached.id}.outputs.cache-hit != 'true'`)) problems.push("a miss is not pulled before the suite");
  if (!/dev-stack\.mjs images \| xargs docker save/.test(steps[pull]?.run ?? "")) problems.push("a miss does not save the images the cache path holds");
  return problems;
}

const browser = () => (parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs.browser.steps as Step[]);

test("the browser job takes the stack's images from a cache, and pulls them only on a cold key", () => {
  assert.deepEqual(imageProblems(browser()), []);
});

test("planted: a job with no cache, a key that ignores dev-stack.mjs, and a hit that is never loaded are each red", () => {
  const steps = browser();
  assert.equal(imageProblems(steps.filter((s) => !/dev-stack-images/.test(s.with?.path ?? ""))).length, 1);
  assert.equal(imageProblems(steps.map((s) => (s.with?.key?.startsWith("dev-stack-images") ? { ...s, with: { ...s.with, key: "dev-stack-images" } } : s))).length, 1);
  assert.equal(imageProblems(steps.filter((s) => !/docker load/.test(s.run ?? ""))).length >= 1, true);
});
