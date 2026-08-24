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

function tracksFor(source: string, ext: "webm" | "m4a"): string[] {
  const pattern = new RegExp(`assets/music/([a-z]+)\\.${ext}`, "g");
  return [...source.matchAll(pattern)].map((m) => m[1]).sort();
}

function onDiskFor(ext: "webm" | "m4a"): string[] {
  return readdirSync(path.join(repoRoot, "assets", "music"))
    .filter((f) => f.endsWith(`.${ext}`))
    .map((f) => f.replace(new RegExp(`\\.${ext}$`), ""))
    .sort();
}

test("assets/music holds exactly the tracks lib/music.ts requires, in both containers", () => {
  const source = readFileSync(path.join(repoRoot, "lib", "music.ts"), "utf8");
  const requiredWebm = tracksFor(source, "webm");
  const requiredM4a = tracksFor(source, "m4a");

  assert.ok(requiredWebm.length > 0, "lib/music.ts requires no WebM music at all");
  assert.deepEqual(
    onDiskFor("webm"),
    requiredWebm,
    "a .webm music file was added or removed without lib/music.ts following it"
  );

  // The iOS encode (#178): AVFoundation cannot demux WebM, so every track also
  // ships as a lossless ALAC re-encode in M4A. A track missing this half is
  // silent music on iOS only — the one platform this suite cannot render code
  // for.
  assert.deepEqual(
    requiredM4a,
    requiredWebm,
    "lib/music.ts requires a different track list for iOS than for web/Android"
  );
  assert.deepEqual(
    onDiskFor("m4a"),
    requiredM4a,
    "a .m4a music file was added or removed without lib/music.ts following it"
  );
});
