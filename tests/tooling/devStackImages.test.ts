import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { cacheName } from "../../scripts/dockerEngine.mjs";

type Step = { name?: string; id?: string; uses?: string; if?: string; run?: string; with?: { path?: string; key?: string } };
const root = path.resolve(import.meta.dirname, "..", "..");
const source = readFileSync(path.join(root, "scripts/dev-stack.mjs"), "utf8");
const named = (name: string) => new RegExp(`^const ${name} = "([^"]+)";$`, "m").exec(source)![1]!;
const run = (cmd: string) => execFileSync(process.execPath, [path.join(root, "scripts/dev-stack.mjs"), cmd], { encoding: "utf8" }).trim().split("\n");

test("dev-stack.mjs names the two images it pulls and the plain tags it runs, with no docker needed", () => {
  assert.deepEqual(run("images"), [named("IMAGE"), named("VALKEY_IMAGE")]);
  assert.deepEqual(run("cached"), [named("CACHED_IMAGE"), named("CACHED_VALKEY_IMAGE")]);
  assert.deepEqual(run("images").map(cacheName), run("cached"), "a cached name that is not the pinned ref's cacheName runs a stale image");
  for (const name of run("cached")) assert.doesNotMatch(name, /@/, "a digest ref is saved with no tag, so a restore cannot find it");
});

test("every container runs a cached name, never the digest ref a restore cannot leave", () => {
  const rest = source.split("\n").filter((l) => !/^const |ensureImage\(|console\.log\(\[IMAGE, VALKEY_IMAGE\]/.test(l));
  assert.deepEqual(rest.filter((l) => /\b(VALKEY_)?IMAGE\b/.test(l)), []);
  assert.ok(rest.some((l) => /CACHED_VALKEY_IMAGE/.test(l)) && rest.some((l) => /^\s+CACHED_IMAGE,/.test(l)), "the containers run the cached names");
});

/** What a shard of the browser job does about the stack's images, as the problems it finds. */
export function imageProblems(steps: Step[]): string[] {
  const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
  const cache = at((s) => /^actions\/cache@/.test(s.uses ?? "") && /dev-stack-images/.test(s.with?.path ?? ""));
  const tests = at((s) => /npm run test:e2e/.test(s.run ?? ""));
  if (cache < 0) return ["no step caches the stack's images, so every shard pulls them from the registry"];
  const cached = steps[cache]!;
  const problems: string[] = [];
  if (!(cached.with?.key ?? "").includes("hashFiles('scripts/dev-stack.mjs')")) problems.push("the cache key does not move with the images dev-stack.mjs names");
  const load = at((s) => /docker load/.test(s.run ?? ""));
  const hit = steps[load];
  if (load < cache || load > tests || !(hit?.if ?? "").includes(`steps.${cached.id}.outputs.cache-hit == 'true'`)) problems.push("a hit is not loaded before the suite");
  if (!/docker load [^\n]*&& node scripts\/dev-stack\.mjs held[^\n]*then exit 0/.test(hit?.run ?? "")) problems.push("a load is not followed by a check that the images it left are the ones dev-stack runs");
  if (!/\n\s*node scripts\/dev-stack\.mjs pull\s*$/.test(hit?.run ?? "")) problems.push("a load that leaves the images out falls back to nothing, so the shard is red");
  const miss = at((s) => (s.if ?? "").includes("cache-hit != 'true'"));
  if (!/dev-stack\.mjs pull/.test(steps[miss]?.run ?? "") || !/dev-stack\.mjs held/.test(steps[miss]?.run ?? "")) problems.push("a miss does not pull and check before it saves");
  if (!/dev-stack\.mjs cached \| xargs docker save/.test(steps[miss]?.run ?? "")) problems.push("a miss does not save the cached names");
  return problems;
}

const browser = () => (parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).jobs.browser.steps as Step[]);

test("the browser job takes the stack's images from a cache, and pulls them only on a cold key", () => {
  assert.deepEqual(imageProblems(browser()), []);
});

test("planted: no cache, a stale key, a hit never loaded, a load never checked, no fallback and a save of the digest refs are each red", () => {
  const steps = browser();
  const edit = (pred: (s: Step) => boolean, f: (s: Step) => Step | null) => steps.flatMap((s) => (pred(s) ? (f(s) ? [f(s)!] : []) : [s]));
  const isLoad = (s: Step) => /docker load/.test(s.run ?? "");
  assert.equal(imageProblems(steps.filter((s) => !/dev-stack-images/.test(s.with?.path ?? ""))).length, 1);
  assert.equal(imageProblems(edit((s) => !!s.with?.key, (s) => ({ ...s, with: { ...s.with, key: "dev-stack-images" } }))).length, 1);
  assert.ok(imageProblems(edit(isLoad, () => null)).length >= 1);
  assert.equal(imageProblems(edit(isLoad, (s) => ({ ...s, run: s.run!.replace(" && node scripts/dev-stack.mjs held", "") }))).length, 1);
  assert.equal(imageProblems(edit(isLoad, (s) => ({ ...s, run: s.run!.replace(/\n\s*node scripts\/dev-stack\.mjs pull\s*$/, "\n") }))).length, 1);
  assert.equal(imageProblems(edit((s) => /xargs docker save/.test(s.run ?? ""), (s) => ({ ...s, run: s.run!.replace("mjs cached", "mjs images") }))).length, 1);
});
