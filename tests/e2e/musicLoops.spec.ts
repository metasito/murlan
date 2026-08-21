// tests/e2e/musicLoops.spec.ts — the four music loops still join seamlessly.
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
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const musicDir = path.resolve(__dirname, "..", "..", "assets", "music");

/** What lib/music.ts requires; tests/musicAssets.test.ts pins that it still does. */
const TRACKS = ["menu", "hand", "cue", "final"] as const;

interface Measured {
  channels: number;
  sampleRate: number;
  /** The wrap, against the 95th-percentile sample-to-sample step in the body. */
  ratioP95: number;
  seamDb: number;
  headMs: number;
  tailMs: number;
}

let measured: Record<string, Measured>;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("about:blank");
  const encoded = Object.fromEntries(
    TRACKS.map((t) => [t, readFileSync(path.join(musicDir, `${t}.webm`)).toString("base64")])
  );
  measured = await page.evaluate(async (files: Record<string, string>) => {
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
      };
    }
    return out;
  }, encoded as Record<string, string>);
  await page.close();
});

test("the music loops join seamlessly", () => {
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
