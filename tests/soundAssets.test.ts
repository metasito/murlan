// tests/soundAssets.test.ts — the sound files themselves.
//
// lib/sounds.ts require()s twelve names. If one is missing, silent, empty, or
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const soundsDir = path.join(repoRoot, "assets", "sounds");

/** Every asset path lib/sounds.ts actually require()s. */
function requiredFiles(): string[] {
  const src = readFileSync(path.join(repoRoot, "lib", "sounds.ts"), "utf8");
  return [...src.matchAll(/require\("\.\.\/assets\/sounds\/([^"]+)"\)/g)].map((m) => m[1]);
}

interface Decoded {
  sampleRate: number;
  samples: number;
  seconds: number;
  peak: number;
  rms: number;
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
  let sumSquares = 0;
  const square = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = pcm[i];
    peak = Math.max(peak, Math.abs(v));
    square[i] = v * v;
    sumSquares += square[i];
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
    rms: Math.sqrt(sumSquares / Math.max(1, n)),
  };
}

/**
 * Decoded length of each shipped effect, in seconds. Decoding alone does not
 * catch a truncated file — mpg123 reports no error on a short stream, and every
 * other measure here (peak, RMS, trailing silence) is scale-free — so the
 * length is pinned per file.
 */
const EXPECTED_SECONDS: Record<string, number> = {
  "bomb.mp3": 1.045,
  "card_pass.mp3": 1.097,
  "card_play.mp3": 0.392,
  "card_select.mp3": 0.731,
  "deal.mp3": 3.161,
  "exchange.mp3": 0.888,
  "game_lose.mp3": 0.496,
  "game_win.mp3": 0.914,
  "round_start.mp3": 0.81,
  "round_win.mp3": 0.392,
  "urgent_tick.mp3": 0.131,
  "your_turn.mp3": 0.235,
};
// MP3 frames are 1152 samples (~26ms at 44.1kHz), so a rebuild can only land on
// multiples of that; the floor keeps the shortest effects clear of the framing.
const DURATION_TOLERANCE_FRACTION = 0.1;
const DURATION_TOLERANCE_FLOOR = 0.03;

function durationTolerance(file: string): number {
  return Math.max(EXPECTED_SECONDS[file] * DURATION_TOLERANCE_FRACTION, DURATION_TOLERANCE_FLOOR);
}

// Trailing audio quieter than this, relative to the file's own peak, is
// inaudible under anything else the game is doing. build-sounds.mjs trims to
// the same floor and fades over 60ms, so a correctly built file has almost none
// of it left.
const SILENCE_FLOOR_DB = -55;
const WINDOW_SECONDS = 0.01;
// Decoded silence runs a frame or so past where build-sounds.mjs trimmed,
// because of MP3's fixed frames and the encoder's priming delay: measured
// 0.060-0.088s across the twelve files.
const MAX_TRAILING_SILENCE = 0.11;

describe("sound assets", () => {
  test("lib/sounds.ts requires exactly the files that exist on disk", () => {
    const required = requiredFiles().sort();
    const onDisk = readdirSync(soundsDir).filter((f) => f.endsWith(".mp3")).sort();
    assert.ok(required.length > 0, "no require() calls found — the scan is broken");
    assert.deepEqual(onDisk, required, "assets/sounds and lib/sounds.ts disagree");
    assert.deepEqual(
      Object.keys(EXPECTED_SECONDS).sort(),
      required,
      "EXPECTED_SECONDS does not cover exactly the shipped effects"
    );
  });

  for (const file of requiredFiles()) {
    test(`${file} is playable audio, not an empty or silent file`, async () => {
      const mp3 = await readMp3(file);
      assert.equal(mp3.sampleRate, 44100, `${file} must be 44.1 kHz`);
      const expected = EXPECTED_SECONDS[file];
      const tolerance = durationTolerance(file);
      assert.ok(
        Math.abs(mp3.seconds - expected) <= tolerance,
        `${file} runs ${mp3.seconds.toFixed(3)}s, expected ${expected}s ±${tolerance.toFixed(3)}s — truncated, padded or rebuilt from a different source`
      );
      // A file of the right size full of zeroes is the failure mode a plain
      // existence check misses entirely.
      assert.ok(mp3.peak > 0.2, `${file} peaks at ${mp3.peak.toFixed(3)} — silent or near-silent`);
      assert.ok(mp3.rms > 0.005, `${file} has RMS ${mp3.rms.toFixed(4)} — no audible content`);
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

  test("the effects are levelled against each other", async () => {
    // build-sounds.mjs normalises every output to 0.89 before encoding; the
    // lossy pass shaves that down to a measured 0.778-0.846.
    for (const file of requiredFiles()) {
      const { peak } = await readMp3(file);
      assert.ok(
        peak > 0.75 && peak <= 1.0,
        `${file} peaks at ${peak.toFixed(3)}, expected a normalised ~0.8`
      );
    }
  });
});
