import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** The dev Postgres container's port search is a different decision that happens to share these two names. */
const OTHER_DECISION: Record<string, string[]> = {
  "scripts/dev-stack.mjs": ["BASE_PORT"],
  "scripts/devStackPort.mjs": ["PORT_SPAN"],
};

function sources(root: string, dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(root, rel);
    return /\.(mjs|js|ts)$/.test(e.name) ? [rel] : [];
  });
}

function definers(name: string, root = repoRoot) {
  const defines = new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${name}\\b`, "m");
  return ["scripts", "tools", "tests"]
    .filter((d) => existsSync(path.join(root, d)))
    .flatMap((d) => sources(root, d))
    .filter((f) => !OTHER_DECISION[f]?.includes(name))
    .filter((f) => defines.test(readFileSync(path.join(root, f), "utf8")))
    .sort();
}

test("each shared script constant is defined in one file only", () => {
  for (const [name, owner] of Object.entries(OWNERS)) assert.deepEqual(definers(name), [owner], name);
});

test("the scan sees a restated constant, exported or not", () => {
  const root = mkdtempSync(path.join(tmpdir(), "owner-scan-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts", "a.mjs"), "const HARD_FACTOR = 3;\n");
    writeFileSync(path.join(root, "scripts", "b.mjs"), "export const HARD_FACTOR = 3;\n");
    assert.deepEqual(definers("HARD_FACTOR", root), ["scripts/a.mjs", "scripts/b.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no npm script sets an environment variable inline, which cmd.exe cannot run", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const inline = Object.entries(scripts).filter(([, cmd]) => /^[A-Z_][A-Z0-9_]*=/.test(cmd));
  assert.deepEqual(inline, []);
});
