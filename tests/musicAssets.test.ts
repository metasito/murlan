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

/** The track names `trackForRoute` can return — the one place a track is chosen. */
export function chosenTracks(source: string): string[] {
  const fn = new RegExp(String.raw`function trackForRoute\([\s\S]*?\n\}`).exec(source);
  if (!fn) return [];
  return [...new Set([...fn[0].matchAll(/return\s+"([a-z]+)"/g)].map((m) => m[1]))].sort();
}

/** The keys of the `TRACKS` map in `source`. */
export function trackKeys(source: string): string[] {
  const map = new RegExp(String.raw`TRACKS = \{[\s\S]*?\n\}`).exec(source);
  if (!map) return [];
  return [...map[0].matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1]).sort();
}

// Agreeing with the files on disk says a track is bundled, not that anything
// plays it. `app/_layout.tsx` is the only caller that names one, so a key it
// never returns is weight in every bundle for a screen that cannot reach it.
test("every track in the map is one app/_layout.tsx can actually choose", () => {
  const declared = trackKeys(readFileSync(path.join(repoRoot, "lib", "musicTracks.ts"), "utf8"));
  const chosen = chosenTracks(readFileSync(path.join(repoRoot, "app", "_layout.tsx"), "utf8"));

  assert.ok(chosen.length > 0, "trackForRoute returns no track literal — this scan reads nothing");
  assert.deepEqual(
    declared,
    chosen,
    "a track nothing plays is bundled on every platform; delete it, or route to it"
  );
});

test("the scan reads the chooser and the map, not the whole file", () => {
  const chooser = [
    "function trackForRoute(p: string): T {",
    '  if (p) return "cue";',
    '  return "menu";',
    "}",
    'return "elsewhere";',
  ].join("\n");
  assert.deepEqual(chosenTracks(chooser), ["cue", "menu"]);

  const map = ["const TRACKS = {", "  menu: () => 1,", "  hand: () => 2,", "} as const;"].join("\n");
  assert.deepEqual(trackKeys(map), ["hand", "menu"]);
});
