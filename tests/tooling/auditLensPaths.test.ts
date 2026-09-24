// tests/tooling/auditLensPaths.test.ts
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const AUDIT = ".claude/workflows/audit.mjs";
const starts = [...readFileSync(AUDIT, "utf8").matchAll(/^\s*start: '([^']*)'/gm)].map((m) => m[1]);

const namedPaths = (start: string) =>
  start.split(/[\s,]+/)
    .filter((word) => /^[\w.+-][\w.+()/-]*$/.test(word) && /\/|\.\w+$/.test(word))
    .filter((word) => !/[*{]/.test(word));

test("every path an audit lens starts from exists", () => {
  const missing = starts.flatMap(namedPaths).filter((path) => !existsSync(path.replace(/\/$/, "")));
  assert.deepEqual(missing, []);
});

test("the lens start lists are read, not skipped", () => {
  assert.ok(starts.length > 10, `expected every lens's start list, got ${starts.length}`);
  assert.ok(starts.flatMap(namedPaths).includes("lib/game/gameEngine.ts"));
});
