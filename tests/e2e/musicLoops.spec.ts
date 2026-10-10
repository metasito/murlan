// tests/e2e/musicLoops.spec.ts — the music loops still join seamlessly, in
// every container they ship in.
//
// #121 settled that music arrives pre-encoded and left this demonstration to
// #113, "when there are tracks to join". A loop whose last sample does not meet
// its first clicks once per pass, every pass, and nothing else in the suite can
// see it: the files are committed artefacts, so a bad re-encode is invisible to
// a typecheck and inaudible to a renderer test.
//
// Here rather than in `npm test` because measuring it means decoding Opus, and
// the only decoder this repo has is a browser — the same route
// scripts/build-sounds.mjs takes. This is the job that already installs one.
//
// iOS and Android ship a second container: the same audio, losslessly
// re-encoded to 48 kHz FLAC (assets/music/README.md, "The native encode").
// Chromium decodes FLAC directly, so both containers get the same waveform
// arithmetic below, and the FLAC must match the WebM sample for sample.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const musicDir = path.resolve(__dirname, "..", "..", "assets", "music");

/** The tracks; tests/tooling/musicAssets.test.ts pins these against what
 * lib/device/musicTracks.ts and lib/device/musicTracks.web.ts actually require. */
const TRACKS = ["menu", "hand"] as const;
const WEBM = Object.fromEntries(TRACKS.map((t) => [t, `${t}.webm`]));
const FLAC = Object.fromEntries(TRACKS.map((t) => [t, `native/${t}.flac`]));

interface Measured {
  channels: number;
  sampleRate: number;
  /** The wrap, against the 95th-percentile sample-to-sample step in the body. */
  ratioP95: number;
  seamDb: number;
  headMs: number;
  tailMs: number;
  samples: number;
}

let measured: Record<string, Measured>;
let measuredFlac: Record<string, Measured>;

async function measure(page: Page, files: Record<string, string>): Promise<Record<string, Measured>> {
  const encoded = Object.fromEntries(
    Object.entries(files).map(([t, file]) => [t, readFileSync(path.join(musicDir, file)).toString("base64")])
  );
  return page.evaluate(async (files: Record<string, string>) => {
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const ctx = new AudioContext({ sampleRate: 48000 });
    const out: Record<string, Measured> = {};
    for (const [key, b64] of Object.entries(files)) {
      const buf = await ctx.decodeAudioData(bytes(b64));
      const ch = buf.getChannelData(0);
      const n = ch.length;
      const seam = Math.abs(ch[0] - ch[n - 1]);
      const steps: number[] = [];
      const stride = Math.max(1, Math.floor(n / 40000));
      for (let i = 1; i < n; i += stride) steps.push(Math.abs(ch[i] - ch[i - 1]));
      steps.sort((a, b) => a - b);
      const p95 = steps[Math.floor(steps.length * 0.95)] || 1e-9;
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[i]));
      let head = 0;
      while (head < n && Math.abs(ch[head]) < 1e-4) head++;
      let tail = n - 1;
      while (tail > 0 && Math.abs(ch[tail]) < 1e-4) tail--;
      out[key] = {
        channels: buf.numberOfChannels,
        sampleRate: buf.sampleRate,
        ratioP95: seam / p95,
        seamDb: 20 * Math.log10(Math.max(seam / peak, 1e-12)),
        headMs: (head / buf.sampleRate) * 1000,
        tailMs: ((n - 1 - tail) / buf.sampleRate) * 1000,
        samples: n,
      };
    }
    return out;
  }, encoded);
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("about:blank");
  measured = await measure(page, WEBM);
  measuredFlac = await measure(page, FLAC);
  await page.close();
});

test("the WebM music loops join seamlessly", () => {
  for (const track of TRACKS) {
    const m = measured[track];
    // At or under 1x, the wrap is no larger than the waveform's own ordinary
    // motion and cannot be heard as a click. The menu loop measured 14.2x
    // before its crossfade was applied, so this is a live threshold.
    expect(
      m.ratioP95,
      `${track} steps ${m.ratioP95.toFixed(2)}x the p95 sample step at the loop join ` +
        `(${m.seamDb.toFixed(1)} dBFS) — it will click once per pass`
    ).toBeLessThanOrEqual(1);

    // The other way a loop fails. Opus carries encoder delay as pre-skip, and a
    // container that does not declare it leaves that delay in the buffer as a
    // gap — the reason #121 chose WebM over Ogg.
    expect(m.headMs, `${track} starts with silence`).toBeLessThan(1);
    expect(m.tailMs, `${track} ends with silence`).toBeLessThan(1);

    expect(m.sampleRate, `${track} is not 48 kHz`).toBe(48000);
    expect(m.channels, `${track} is not stereo`).toBe(2);
  }
});

// The floor. Every assertion above is satisfied by a file of pure silence: its
// seam is zero and its rate is whatever was asked for.
test("the measurement would notice a bad join", () => {
  const worst = Math.max(...TRACKS.map((t) => measured[t].ratioP95));
  expect(
    worst,
    "every seam measured exactly zero, which means the decode produced silence " +
      "rather than music and these tests are asserting nothing"
  ).toBeGreaterThan(0);
});

test("the FLAC music loops join seamlessly, sample for sample with the WebM", () => {
  for (const track of TRACKS) {
    const m = measuredFlac[track];
    expect(m.ratioP95, `${track}.flac steps ${m.ratioP95.toFixed(2)}x the p95 step at the join`).toBeLessThanOrEqual(1);
    expect(m.headMs, `${track}.flac starts with silence`).toBeLessThan(1);
    expect(m.tailMs, `${track}.flac ends with silence`).toBeLessThan(1);
    expect(m.sampleRate).toBe(48000);
    expect(m.channels).toBe(2);
    expect(m.samples, `${track}.flac and ${track}.webm differ in length`).toBe(measured[track].samples);
  }
});

test("the FLAC measurement would notice a bad join", () => {
  expect(Math.max(...TRACKS.map((t) => measuredFlac[t].ratioP95))).toBeGreaterThan(0);
});
