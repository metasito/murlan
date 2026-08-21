// tests/musicAssets.test.ts — assets/music and lib/music.ts still agree.
//
// Metro bundles what a `require` names, so a file added here without one is
// dead weight and a require without a file is a runtime failure on the screen
// that plays it. Whether those files still *loop* needs a decoder, which is
// tests/e2e/musicLoops.spec.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("assets/music holds exactly the tracks lib/music.ts requires", () => {
  const source = readFileSync(path.join(repoRoot, "lib", "music.ts"), "utf8");
  const required = [...source.matchAll(/assets\/music\/([a-z]+)\.webm/g)].map((m) => m[1]).sort();
  const onDisk = readdirSync(path.join(repoRoot, "assets", "music"))
    .filter((f) => f.endsWith(".webm"))
    .map((f) => f.replace(/\.webm$/, ""))
    .sort();

  assert.ok(required.length > 0, "lib/music.ts requires no music at all");
  assert.deepEqual(
    onDisk,
    required,
    "a music file was added or removed without lib/music.ts following it"
  );
});
