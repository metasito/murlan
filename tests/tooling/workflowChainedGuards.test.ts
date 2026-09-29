import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflows = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");
const chainedGuard = (line: string) => /^\s*(test|\[)\s.*&&\s*(test|\[)\s/.test(line) && !/\|\||\{/.test(line);

test("a guard chained to another guard with && is flagged; a guard that acts or fails loudly is not", () => {
  assert.ok(chainedGuard('          test -d "$lib/a" && test -d "$lib/b"'));
  assert.ok(chainedGuard("  [ -f x ] && [ -f y ]"));
  assert.ok(!chainedGuard('            [ -d "$candidate" ] && { app="$candidate"; break; }'));
  assert.ok(!chainedGuard('          [ "$BRANCH" != main ] && branches+=("$BRANCH")'));
  assert.ok(!chainedGuard('          [ -n "$apk" ] && [ -f "$apk" ] || { echo "::error::no APK"; exit 1; }'));
});

test("no workflow step guards with a test that set -e cannot fail on", () => {
  const lines = readdirSync(workflows)
    .filter((f) => f.endsWith(".yml"))
    .flatMap((f) => readFileSync(path.join(workflows, f), "utf8").split("\n").map((l, i) => [`${f}:${i + 1}`, l] as const));
  assert.ok(lines.length > 1000, `read ${lines.length} workflow lines`);
  assert.deepEqual(lines.filter(([, l]) => chainedGuard(l)).map(([at]) => at), []);
});
