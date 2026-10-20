import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const OWNERS: Record<string, string> = {
  HARD_FACTOR: "tools/ci/e2e-budget.mjs",
  BASE_PORT: "tools/ci/e2ePortRange.mjs",
  PORT_SPAN: "tools/ci/e2ePortRange.mjs",
  PLAY_PORT: "tools/ci/e2ePortRange.mjs",
  COLLECTOR_PORT: "scripts/diagnostics-collector.mjs",
};

/** The dev Postgres container's port search is a different decision that happens to share two names. */
const OTHER_DECISION = new Set(["scripts/dev-stack.mjs", "scripts/devStackPort.mjs"]);

function sources(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(rel);
    return /\.(mjs|js|ts)$/.test(e.name) ? [rel] : [];
  });
}

function definers(name: string) {
  const defines = new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${name}\\b`, "m");
  return ["scripts", "tools", "tests"]
    .flatMap(sources)
    .filter((f) => !OTHER_DECISION.has(f))
    .filter((f) => defines.test(readFileSync(path.join(repoRoot, f), "utf8")))
    .sort();
}

test("each shared script constant is defined in one file only", () => {
  for (const [name, owner] of Object.entries(OWNERS)) assert.deepEqual(definers(name), [owner], name);
});

test("the scan sees a restated constant, exported or not", () => {
  const planted = path.join(repoRoot, "scripts", "plantedRestatement.mjs");
  writeFileSync(planted, "const HARD_FACTOR = 3;\n");
  try {
    assert.deepEqual(definers("HARD_FACTOR"), ["scripts/plantedRestatement.mjs", "tools/ci/e2e-budget.mjs"]);
  } finally {
    rmSync(planted, { force: true });
  }
});

test("no npm script sets an environment variable inline, which cmd.exe cannot run", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const inline = Object.entries(scripts).filter(([, cmd]) => /^[A-Z_][A-Z0-9_]*=/.test(cmd));
  assert.deepEqual(inline, []);
});
