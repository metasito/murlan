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

// A one-shot effect in a card game. Nothing here is music; anything running
// longer than this is a bug in the build, not a design choice.
const CEILING_SECONDS = 4;
// Trailing audio quieter than this, relative to the file's own peak, is
// inaudible under anything else the game is doing. build-sounds.mjs trims to
// the same floor and fades over 60ms, so a correctly built file has almost none
// of it left.
const SILENCE_FLOOR_DB = -55;
const WINDOW_SECONDS = 0.01;
// MP3 frames are fixed 1152-sample blocks (~26ms at 44.1kHz) and the encoder
// adds priming delay before the first one, so decoded silence can run a
// frame or so past where build-sounds.mjs actually trimmed — measured up to
// ~88ms across the current twelve files. The budget below has margin over
// that for a future rebuild without going slack enough to hide a real bug.
const MAX_TRAILING_SILENCE = 0.15;

describe("sound assets", () => {
  test("lib/sounds.ts requires exactly the files that exist on disk", () => {
    const required = requiredFiles().sort();
    const onDisk = readdirSync(soundsDir).filter((f) => f.endsWith(".mp3")).sort();
    assert.ok(required.length > 0, "no require() calls found — the scan is broken");
    assert.deepEqual(onDisk, required, "assets/sounds and lib/sounds.ts disagree");
  });

  for (const file of requiredFiles()) {
    test(`${file} is playable audio, not an empty or silent file`, async () => {
      const mp3 = await readMp3(file);
      assert.equal(mp3.sampleRate, 44100, `${file} must be 44.1 kHz`);
      assert.ok(mp3.seconds > 0.02, `${file} is ${mp3.seconds.toFixed(3)}s — effectively empty`);
      // A file of the right size full of zeroes is the failure mode a plain
      // existence check misses entirely.
      assert.ok(mp3.peak > 0.2, `${file} peaks at ${mp3.peak.toFixed(3)} — silent or near-silent`);
      assert.ok(mp3.rms > 0.005, `${file} has RMS ${mp3.rms.toFixed(4)} — no audible content`);
    });

    test(`${file} carries no dead air at the end`, async () => {
      const mp3 = await readMp3(file);
      assert.ok(
        mp3.seconds <= CEILING_SECONDS,
        `${file} runs ${mp3.seconds.toFixed(2)}s, ceiling ${CEILING_SECONDS}s`
      );
      const silence = mp3.seconds - mp3.soundEndsAt;
      assert.ok(
        silence <= MAX_TRAILING_SILENCE,
        `${file} has ${silence.toFixed(3)}s of near-silence after the sound ends`
      );
    });
  }

  test("the effects are levelled against each other", async () => {
    // The source packs are mastered at different levels; build-sounds.mjs
    // normalises every output to the same headroom before MP3 encoding.
    // Lossy encoding then shaves a bit off the true peak (measured: a PCM
    // peak normalised to 0.89 decodes back at roughly 0.78-0.85), so the
    // floor here is below the encoder's target rather than at it — the
    // point of the assertion is catching one effect startlingly louder or
    // quieter than the rest, not pinning the exact peak MP3 reproduces.
    for (const file of requiredFiles()) {
      const { peak } = await readMp3(file);
      assert.ok(
        peak > 0.7 && peak <= 1.0,
        `${file} peaks at ${peak.toFixed(3)}, expected a normalised ~0.8`
      );
    }
  });
});
