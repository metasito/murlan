// tests/musicAssets.test.ts — assets/music and lib/musicTracks{,.ios}.ts
// still agree.
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

function tracksFor(file: string, ext: "webm" | "m4a"): string[] {
  const source = readFileSync(path.join(repoRoot, "lib", file), "utf8");
  const pattern = new RegExp(`assets/music/([a-z]+)\\.${ext}`, "g");
  return [...source.matchAll(pattern)].map((m) => m[1]).sort();
}

function onDiskFor(ext: "webm" | "m4a"): string[] {
  return readdirSync(path.join(repoRoot, "assets", "music"))
    .filter((f) => f.endsWith(`.${ext}`))
    .map((f) => f.replace(new RegExp(`\\.${ext}$`), ""))
    .sort();
}

test("assets/music holds exactly the tracks lib/musicTracks.ts and lib/musicTracks.ios.ts require", () => {
  const requiredWebm = tracksFor("musicTracks.ts", "webm");
  const requiredM4a = tracksFor("musicTracks.ios.ts", "m4a");

  assert.ok(requiredWebm.length > 0, "lib/musicTracks.ts requires no WebM music at all");
  assert.deepEqual(
    onDiskFor("webm"),
    requiredWebm,
    "a .webm music file was added or removed without lib/musicTracks.ts following it"
  );

  // Why iOS needs its own encode at all: assets/music/README.md, "The iOS encode".
  assert.deepEqual(
    requiredM4a,
    requiredWebm,
    "lib/musicTracks.ios.ts requires a different track list than lib/musicTracks.ts"
  );
  assert.deepEqual(
    onDiskFor("m4a"),
    requiredM4a,
    "a .m4a music file was added or removed without lib/musicTracks.ios.ts following it"
  );
});
