// tools/loop/tests/loopTestEnv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "tests" ? [] : sources(p);
    return /\.(mjs|ts)$/.test(name) ? [p] : [];
  });
}

/** Read as `env.LOOP_X` as well as `process.env.LOOP_X`, so the name is matched, not the access. */
function loopVariables(): string[] {
  const names = sources(path.join(ROOT, "tools/loop")).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/\bLOOP_[A-Z][A-Z_]*\b/g)].map((m) => m[0]),
  );
  return [...new Set(names)].sort();
}

/** `loop:test`'s own arguments, with its file glob swapped for `file`. */
function loopTestArgs(file: string): string[] {
  const script: string = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts["loop:test"];
  const words = script.split(/\s+/).map((w) => w.replace(/^"|"$/g, ""));
  assert.equal(words[0], "node", script);
  assert.match(words.at(-1)!, /^tools\/loop\/tests\//, script);
  return [...words.slice(1, -1), file];
}

function probeSees(args: string[], env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(path.join(tmpdir(), "loop-env-"));
  try {
    const out = path.join(dir, "seen.json");
    const probe = path.join(dir, "probe.test.mjs");
    writeFileSync(
      probe,
      `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(process.env).filter((k) => k.startsWith("LOOP_"))));\n`,
    );
    const run = spawnSync(process.execPath, args.map((a) => (a === "<probe>" ? probe : a)), {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    return JSON.parse(readFileSync(out, "utf8")) as string[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no tools/loop/tests file inherits the LOOP_* a loop process set", () => {
  const names = loopVariables();
  for (const known of ["LOOP_TURNS", "LOOP_PHASE", "LOOP_REASON", "LOOP_BASE", "LOOP_WORKTREE"]) {
    assert.ok(names.includes(known), `${known} not found under tools/loop/: the scan has drifted`);
  }
  const env = { ...process.env, ...Object.fromEntries(names.map((n) => [n, "set-by-the-loop"])) };

  assert.deepEqual(probeSees(["--test", "<probe>"], env).sort(), names, "a bare node --test passes the caller's env through");
  assert.deepEqual(probeSees(loopTestArgs("<probe>"), env), [], "npm run loop:test hands a test file the caller's LOOP_*");
});
