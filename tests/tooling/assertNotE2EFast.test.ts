import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "assertNotE2EFast.js");

function guard(files: Record<string, string>, env: Record<string, string> = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "murlan-e2e-guard-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(cwd, name), body);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("EXPO_PUBLIC_E2E_") && k !== "NODE_ENV")
  );
  return spawnSync(process.execPath, [SCRIPT], { cwd, env: { ...clean, ...env } as NodeJS.ProcessEnv, encoding: "utf8" });
}

test("passes a project with no test-only flag", () => {
  assert.equal(guard({ ".env": "EXPO_PUBLIC_DOMAIN=example.com\n" }).status, 0);
});

test("refuses any EXPO_PUBLIC_E2E_* flag in the environment", () => {
  const r = guard({}, { EXPO_PUBLIC_E2E_SOMETHING_NEW: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /EXPO_PUBLIC_E2E_SOMETHING_NEW/);
});

for (const file of [".env", ".env.production", ".env.local", ".env.production.local"]) {
  test(`refuses a flag that only ${file} sets`, () => {
    const r = guard({ [file]: "EXPO_PUBLIC_E2E_REDUCE_MOTION=1\n" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /EXPO_PUBLIC_E2E_REDUCE_MOTION/);
  });
}

test("the production build runs the guard first", () => {
  const root = path.dirname(path.dirname(SCRIPT));
  const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.match(scripts["expo:web:build"], /^node scripts\/assertNotE2EFast\.js && /);
});
