import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ensureEngine, dockerDesktopPaths, dockerInfo } from "../../scripts/dockerEngine.mjs";

const probe = (upAfter: number) => { let n = 0; return () => ++n > upAfter; };
const base = (o: Record<string, unknown> = {}) => {
  const launched: string[] = []; let slept = 0;
  const opts = { engineUp: probe(0), exists: () => true, launch: (p: string) => launched.push(p), sleep: () => slept++, platform: "win32", paths: ["A", "B"], budgetMs: 30_000, stepMs: 5_000, ...o };
  return { opts, launched, slept: () => slept };
};

describe("ensureEngine", () => {
  test("an engine already up launches nothing", () => {
    const t = base({ engineUp: () => true });
    assert.equal(ensureEngine(t.opts as never), "up");
    assert.deepEqual(t.launched, []);
  });
  test("a down engine launches the first existing path once and waits for it", () => {
    const t = base({ engineUp: probe(3), exists: (p: string) => p === "B" });
    assert.equal(ensureEngine(t.opts as never), "started");
    assert.deepEqual(t.launched, ["B"]);
  });
  test("no Docker Desktop on disk names every path tried", () => {
    const t = base({ engineUp: () => false, exists: () => false });
    assert.throws(() => ensureEngine(t.opts as never), /A, B/);
  });
  test("an engine that never comes up gives up at the budget, not later", () => {
    const t = base({ engineUp: () => false });
    assert.throws(() => ensureEngine(t.opts as never), /within 30s/);
    assert.equal(t.slept(), 6);
  });
  test("off Windows it says to start the engine and launches nothing", () => {
    const t = base({ engineUp: () => false, platform: "linux" });
    assert.throws(() => ensureEngine(t.opts as never), /not running/);
    assert.deepEqual(t.launched, []);
  });
  const answers = (...said: unknown[]) => {
    const asked: number[] = [];
    let n = 0;
    return { asked, engineUp: (ms: number) => (asked.push(ms), said[Math.min(n++, said.length - 1)]) };
  };
  test("a slow probe is not a down engine: nothing is launched, and it is asked again for longer", () => {
    const a = answers("slow", true);
    const t = base({ engineUp: a.engineUp });
    assert.equal(ensureEngine(t.opts as never), "up");
    assert.deepEqual(t.launched, []);
    assert.equal(a.asked.length, 2);
    assert.ok(a.asked[1] > a.asked[0], `asked ${a.asked}`);
  });
  test("an engine that stays slow is waited out within the budget, never launched again", () => {
    const a = answers("slow");
    const t = base({ engineUp: a.engineUp, budgetMs: 180_000 });
    assert.throws(() => ensureEngine(t.opts as never), /did not answer/);
    assert.deepEqual(t.launched, []);
    assert.ok(a.asked.length < 6, `asked ${a.asked.length} times`);
  });
  test("slow, then known down, launches once", () => {
    const t = base({ engineUp: answers("slow", false, false, true).engineUp });
    assert.equal(ensureEngine(t.opts as never), "started");
    assert.deepEqual(t.launched, ["A"]);
  });
  test("docker info timing out or killed reads as slow; a quick failure as down", () => {
    const up = (r: object) => dockerInfo(() => r as never)(15_000);
    assert.equal(up({ status: 0 }), true);
    assert.equal(up({ status: 1 }), false);
    assert.equal(up({ status: null, error: { code: "ENOENT" } }), false);
    assert.equal(up({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } }), "slow");
    assert.equal(up({ status: null, signal: "SIGKILL" }), "slow");
  });
  test("LOCALAPPDATA's install is tried first", () => {
    assert.match(dockerDesktopPaths({ LOCALAPPDATA: "L", ProgramFiles: "P" } as never)[0], /^L\\Programs\\DockerDesktop\\Docker Desktop\.exe$/);
  });
});
