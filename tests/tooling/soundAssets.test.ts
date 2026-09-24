// tests/tooling/soundAssets.test.ts — the sound files themselves.
//
// lib/device/sounds.ts require()s nineteen names. If one is missing, silent, empty, or
// not actually the format its extension claims, nothing throws: the effect just
// never plays, on one platform or on all of them. That is the failure this
// guards, and it is why every file is decoded and measured rather than merely
// checked for existence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MPEGDecoder } from "mpg123-decoder";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const soundsDir = path.join(repoRoot, "assets", "sounds");

/** Every asset path lib/device/sounds.ts actually require()s. */
function requiredFiles(): string[] {
  const src = readFileSync(path.join(repoRoot, "lib", "device", "sounds.ts"), "utf8");
  return [...src.matchAll(/require\("\.\.\/\.\.\/assets\/sounds\/([^"]+)"\)/g)].map((m) => m[1]);
}

interface Decoded {
  sampleRate: number;
  samples: number;
  seconds: number;
  peak: number;
  lufs: number;
  /** Last moment the signal is still above SILENCE_FLOOR_DB of its own peak. */
  soundEndsAt: number;
}

async function readMp3(file: string): Promise<Decoded> {
  const buf = readFileSync(path.join(soundsDir, file));

  const decoder = new MPEGDecoder();
  await decoder.ready;
  const result = decoder.decode(buf);
  decoder.free();

  assert.equal(result.errors.length, 0, `${file}: decode errors ${JSON.stringify(result.errors)}`);
  assert.ok(result.channelData.length > 0, `${file} decoded to no channels`);

  // build-sounds.mjs encodes mono; the decoder always reports two channels,
  // duplicating the single decoded one into both (confirmed against the
  // MPEG frame header's channel-mode bits, which do say mono). Assert the
  // duplicate rather than silently trusting it, so a future encoder that
  // actually produces stereo content is caught here.
  assert.deepEqual(
    result.channelData[0],
    result.channelData[1],
    `${file} decoded to two different channels — is it still mono?`
  );
  const pcm = result.channelData[0];
  const n = pcm.length;

  let peak = 0;
  const square = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = pcm[i];
    peak = Math.max(peak, Math.abs(v));
    square[i] = v * v;
  }
  // Same criterion build-sounds.mjs trims by, so this is stable on a file that
  // has already been trimmed. A proportional measure would not be: removing the
  // quiet tail shrinks the total it is a proportion of.
  const floor = peak * Math.pow(10, SILENCE_FLOOR_DB / 20);
  const win = Math.max(1, Math.round(WINDOW_SECONDS * result.sampleRate));
  let soundEnd = 0;
  for (let start = 0; start < n; start += win) {
    const stop = Math.min(n, start + win);
    let sum = 0;
    for (let i = start; i < stop; i++) sum += square[i];
    if (Math.sqrt(sum / (stop - start)) > floor) soundEnd = stop;
  }
  return {
    soundEndsAt: soundEnd / result.sampleRate,
    sampleRate: result.sampleRate,
    samples: n,
    seconds: n / result.sampleRate,
    peak,
    lufs: integratedLoudness(pcm, result.sampleRate),
  };
}

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

function biquad(x: Float64Array, [b0, b1, b2, a1, a2]: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    y[i] = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y[i];
  }
  return y;
}

/**
 * ITU-R BS.1770-4 integrated loudness, gated; it reads the same as ffmpeg's
 * `ebur128` filter. A file shorter than one 400 ms block is measured as one block.
 */
function integratedLoudness(pcm: Float32Array, fs: number): number {
  const shelf = (() => {
    const K = Math.tan((Math.PI * 1681.974450955533) / fs), Q = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
      (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] as Biquad;
  })();
  const highPass = (() => {
    const K = Math.tan((Math.PI * 38.13547087602444) / fs), Q = 0.5003270373238773;
    const a0 = 1 + K / Q + K * K;
    return [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] as Biquad;
  })();
  const y = biquad(biquad(Float64Array.from(pcm), shelf), highPass);
  const block = Math.min(y.length, Math.round(0.4 * fs));
  const hop = Math.round(0.1 * fs);
  const powers: number[] = [];
  for (let start = 0; start + block <= y.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += y[i] * y[i];
    powers.push(sum / block);
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  const mean = (ps: number[]) => ps.reduce((a, b) => a + b, 0) / ps.length;
  const audible = powers.filter((p) => lk(p) > -70);
  const relative = lk(mean(audible)) - 10;
  return lk(mean(audible.filter((p) => lk(p) > relative)));
}

/**
 * Decoded length and integrated loudness of each shipped effect. Decoding alone
 * does not catch a truncated file — mpg123 reports no error on a short stream —
 * so the length is pinned per file. The loudness is pinned because each file
 * carries its own level: sounds.ts plays the picks at unity.
 */
const EXPECTED: Record<string, { seconds: number; lufs: number }> = {
  "bomb.mp3": { seconds: 1.475, lufs: -23.3 },
  "clock_running_out.mp3": { seconds: 2.585, lufs: -25.2 },
  "combo.mp3": { seconds: 0.628, lufs: -26.8 },
  "deal.mp3": { seconds: 2.958, lufs: -30.3 },
  "exchange.mp3": { seconds: 0.675, lufs: -29.6 },
  "manche_lost.mp3": { seconds: 0.863, lufs: -23.8 },
  "manche_won.mp3": { seconds: 1.229, lufs: -21.5 },
  "partita_lost.mp3": { seconds: 1.255, lufs: -21.5 },
  "partita_won.mp3": { seconds: 2.415, lufs: -18.6 },
  "pass.mp3": { seconds: 0.232, lufs: -27.7 },
  "play.mp3": { seconds: 0.235, lufs: -26.9 },
  "reconnected.mp3": { seconds: 0.68, lufs: -24.9 },
  "reject.mp3": { seconds: 0.209, lufs: -19.3 },
  "room_full.mp3": { seconds: 0.287, lufs: -18.6 },
  "round_start.mp3": { seconds: 0.81, lufs: -22.7 },
  "round_win.mp3": { seconds: 0.392, lufs: -23.2 },
  "seat_fill.mp3": { seconds: 0.261, lufs: -24.2 },
  "select.mp3": { seconds: 0.262, lufs: -29.8 },
  "turn.mp3": { seconds: 0.694, lufs: -22.9 },
};
const LUFS_TOLERANCE = 1;
/** The -1 dBFS ceiling build-sounds.mjs normalises to and the picks were capped at. */
const PEAK_CEILING = 0.891;
// MP3 frames are 1152 samples (~26ms at 44.1kHz), so a rebuild can only land on
// multiples of that; the floor keeps the shortest effects clear of the framing.
const DURATION_TOLERANCE_FRACTION = 0.1;
const DURATION_TOLERANCE_FLOOR = 0.03;

function durationTolerance(file: string): number {
  return Math.max(EXPECTED[file].seconds * DURATION_TOLERANCE_FRACTION, DURATION_TOLERANCE_FLOOR);
}

// Trailing audio quieter than this, relative to the file's own peak, is
// inaudible under anything else the game is doing. build-sounds.mjs trims to
// the same floor and fades over 60ms, so a correctly built file has almost none
// of it left.
const SILENCE_FLOOR_DB = -55;
const WINDOW_SECONDS = 0.01;
// Decoded silence runs a frame or so past where build-sounds.mjs trimmed,
// because of MP3's fixed frames and the encoder's priming delay: measured
// 0.060-0.088s across the effect files.
const MAX_TRAILING_SILENCE = 0.11;

describe("sound assets", () => {
  test("lib/device/sounds.ts requires exactly the files that exist on disk", () => {
    const required = requiredFiles().sort();
    const onDisk = readdirSync(soundsDir).filter((f) => f.endsWith(".mp3")).sort();
    assert.ok(required.length > 0, "no require() calls found — the scan is broken");
    assert.deepEqual(onDisk, required, "assets/sounds and lib/device/sounds.ts disagree");
    assert.equal(required.length, 19, "sounds.ts should require nineteen files");
    assert.deepEqual(Object.keys(EXPECTED).sort(), required, "EXPECTED does not cover exactly the shipped effects");
  });

  for (const file of requiredFiles()) {
    test(`${file} is playable audio, not an empty or silent file`, async () => {
      const mp3 = await readMp3(file);
      assert.equal(mp3.sampleRate, 44100, `${file} must be 44.1 kHz`);
      const { seconds, lufs } = EXPECTED[file];
      const tolerance = durationTolerance(file);
      assert.ok(
        Math.abs(mp3.seconds - seconds) <= tolerance,
        `${file} runs ${mp3.seconds.toFixed(3)}s, expected ${seconds}s ±${tolerance.toFixed(3)}s — truncated, padded or rebuilt from a different source`
      );
      // A file of the right size full of zeroes is the failure mode a plain
      // existence check misses entirely; the gate leaves it no loudness at all.
      assert.ok(
        Number.isFinite(mp3.lufs) && Math.abs(mp3.lufs - lufs) <= LUFS_TOLERANCE,
        `${file} measures ${mp3.lufs.toFixed(1)} LUFS, expected ${lufs} ±${LUFS_TOLERANCE} — silent, or re-levelled`
      );
    });

    test(`${file} carries no dead air at the end`, async () => {
      const mp3 = await readMp3(file);
      const silence = mp3.seconds - mp3.soundEndsAt;
      assert.ok(
        silence <= MAX_TRAILING_SILENCE,
        `${file} has ${silence.toFixed(3)}s of near-silence after the sound ends`
      );
    });
  }

  test("no effect peaks above -1 dBFS", async () => {
    for (const file of requiredFiles()) {
      const { peak } = await readMp3(file);
      assert.ok(peak <= PEAK_CEILING, `${file} peaks at ${peak.toFixed(3)}, above ${PEAK_CEILING}`);
    }
  });

  test("a trick won sits under the manche won", async () => {
    const trick = await readMp3("round_win.mp3");
    const manche = await readMp3("manche_won.mp3");
    assert.ok(
      trick.lufs < manche.lufs,
      `round_win at ${trick.lufs.toFixed(1)} LUFS is not under manche_won at ${manche.lufs.toFixed(1)}`
    );
  });
});
