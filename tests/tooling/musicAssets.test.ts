// tests/tooling/musicAssets.test.ts — assets/music and lib/device/musicTracks{,.web}.ts
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
import { moduleEdges } from "../helpers/moduleEdges.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function tracksFor(file: string, ext: "webm" | "flac"): string[] {
  const rel = `lib/device/${file}`;
  return moduleEdges(rel, readFileSync(path.join(repoRoot, rel), "utf8"))
    .filter((e) => e.via === "require" && e.to.endsWith(`.${ext}`))
    .map((e) => path.posix.basename(e.to, `.${ext}`))
    .sort();
}

function onDiskFor(dir: string, ext: "webm" | "flac"): string[] {
  return readdirSync(path.join(repoRoot, dir))
    .filter((f) => f.endsWith(`.${ext}`))
    .map((f) => f.slice(0, -ext.length - 1))
    .sort();
}

interface StreamInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  samples: number;
}

export function streamInfo(buf: Buffer): StreamInfo {
  assert.equal(buf.toString("ascii", 0, 4), "fLaC", "not a FLAC file");
  assert.equal(buf[4] & 0x7f, 0, "the first metadata block is not STREAMINFO");
  const b = buf.subarray(8, 42);
  return {
    sampleRate: (b[10] << 12) | (b[11] << 4) | (b[12] >> 4),
    channels: ((b[12] >> 1) & 0x07) + 1,
    bits: (((b[12] & 0x01) << 4) | (b[13] >> 4)) + 1,
    samples: (b[13] & 0x0f) * 2 ** 32 + b.readUInt32BE(14),
  };
}

test("web requires exactly the WebM on disk, native exactly the FLAC, and the two name the same tracks", () => {
  const webm = tracksFor("musicTracks.web.ts", "webm");
  const flac = tracksFor("musicTracks.ts", "flac");
  assert.ok(webm.length > 0, "musicTracks.web.ts requires no WebM — the scan reads nothing");
  assert.deepEqual(onDiskFor("assets/music", "webm"), webm);
  assert.deepEqual(onDiskFor("assets/music/native", "flac"), flac);
  assert.deepEqual(flac, webm);
});

test("the STREAMINFO reader reads a planted header", () => {
  const b = Buffer.alloc(42);
  b.write("fLaC", 0, "ascii");
  b[4] = 0x80;
  b.writeUIntBE(34, 5, 3);
  b[18] = 0x0b; b[19] = 0xb8; b[20] = (1 << 1) | 0;
  b[21] = 0xf0 | 0x00; b.writeUInt32BE(1315611, 22);
  assert.deepEqual(streamInfo(b), { sampleRate: 48000, channels: 2, bits: 16, samples: 1315611 });
});

test("each FLAC is 48 kHz 16-bit stereo, the WebM's length, and not a silent stub", () => {
  for (const track of tracksFor("musicTracks.ts", "flac")) {
    const bytes = readFileSync(path.join(repoRoot, "assets", "music", "native", `${track}.flac`));
    const info = streamInfo(bytes);
    assert.deepEqual({ ...info, samples: undefined }, { sampleRate: 48000, channels: 2, bits: 16, samples: undefined }, track);
    assert.equal(info.samples, 1315611, `${track}.flac is not the loop's 27.408562 s at 48 kHz`);
    assert.ok(bytes.length / info.samples > 0.3, `${track}.flac compresses like silence`);
  }
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
  const declared = trackKeys(readFileSync(path.join(repoRoot, "lib", "device", "musicTracks.ts"), "utf8"));
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
