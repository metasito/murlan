import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ensureEngine, dockerDesktopPaths } from "../../scripts/dockerEngine.mjs";

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
  test("LOCALAPPDATA's install is tried first", () => {
    assert.match(dockerDesktopPaths({ LOCALAPPDATA: "L", ProgramFiles: "P" } as never)[0], /^L\\Programs\\DockerDesktop\\Docker Desktop\.exe$/);
  });
});
