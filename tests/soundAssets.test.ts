// tests/soundAssets.test.ts — the sound files themselves.
//
// lib/sounds.ts require()s twelve names. If one is missing, silent, empty, or
// not actually the format its extension claims, nothing throws: the effect just
// never plays, on one platform or on all of them. That is the failure this
// guards, and it is why every file is opened and its header read rather than
// merely checked for existence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const soundsDir = path.join(repoRoot, "assets", "sounds");

/** Every asset path lib/sounds.ts actually require()s. */
function requiredFiles(): string[] {
  const src = readFileSync(path.join(repoRoot, "lib", "sounds.ts"), "utf8");
  return [...src.matchAll(/require\("\.\.\/assets\/sounds\/([^"]+)"\)/g)].map((m) => m[1]);
}

interface Wav {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  samples: number;
  seconds: number;
  peak: number;
  rms: number;
  /** Last moment the signal is still above SILENCE_FLOOR_DB of its own peak. */
  soundEndsAt: number;
}

function readWav(file: string): Wav {
  const b = readFileSync(path.join(soundsDir, file));
  assert.equal(b.toString("ascii", 0, 4), "RIFF", `${file} is not a RIFF file`);
  assert.equal(b.toString("ascii", 8, 12), "WAVE", `${file} is not a WAVE file`);

  // Walk the chunks rather than assuming a 44-byte header: an encoder that
  // inserts LIST/fact would otherwise shift every offset silently.
  let pos = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  let data: Buffer | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = b.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      data = body;
    }
    pos += 8 + size + (size % 2);
  }
  assert.ok(fmt, `${file} has no fmt chunk`);
  assert.ok(data, `${file} has no data chunk`);
  assert.equal(fmt!.format, 1, `${file} is not uncompressed PCM`);

  const n = Math.floor(data!.length / 2);
  let peak = 0;
  let sumSquares = 0;
  const square = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = data!.readInt16LE(i * 2) / 32768;
    peak = Math.max(peak, Math.abs(v));
    square[i] = v * v;
    sumSquares += square[i];
  }
  // Same criterion build-sounds.mjs trims by, so this is stable on a file that
  // has already been trimmed. A proportional measure would not be: removing the
  // quiet tail shrinks the total it is a proportion of.
  const floor = peak * Math.pow(10, SILENCE_FLOOR_DB / 20);
  const win = Math.max(1, Math.round(WINDOW_SECONDS * fmt!.sampleRate));
  let soundEnd = 0;
  for (let start = 0; start < n; start += win) {
    const stop = Math.min(n, start + win);
    let sum = 0;
    for (let i = start; i < stop; i++) sum += square[i];
    if (Math.sqrt(sum / (stop - start)) > floor) soundEnd = stop;
  }
  return {
    soundEndsAt: soundEnd / fmt!.channels / fmt!.sampleRate,
    channels: fmt!.channels,
    sampleRate: fmt!.sampleRate,
    bitsPerSample: fmt!.bits,
    samples: n / fmt!.channels,
    seconds: n / fmt!.channels / fmt!.sampleRate,
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
const MAX_TRAILING_SILENCE = 0.09;

describe("sound assets", () => {
  test("lib/sounds.ts requires exactly the files that exist on disk", () => {
    const required = requiredFiles().sort();
    const onDisk = readdirSync(soundsDir).filter((f) => f.endsWith(".wav")).sort();
    assert.ok(required.length > 0, "no require() calls found — the scan is broken");
    assert.deepEqual(onDisk, required, "assets/sounds and lib/sounds.ts disagree");
  });

  for (const file of requiredFiles()) {
    test(`${file} is playable audio, not an empty or silent file`, () => {
      const wav = readWav(file);
      assert.equal(wav.channels, 1, `${file} must be mono`);
      assert.equal(wav.bitsPerSample, 16, `${file} must be 16-bit`);
      assert.equal(wav.sampleRate, 44100, `${file} must be 44.1 kHz`);
      assert.ok(wav.seconds > 0.02, `${file} is ${wav.seconds.toFixed(3)}s — effectively empty`);
      // A file of the right size full of zeroes is the failure mode a plain
      // existence check misses entirely.
      assert.ok(wav.peak > 0.2, `${file} peaks at ${wav.peak.toFixed(3)} — silent or near-silent`);
      assert.ok(wav.rms > 0.005, `${file} has RMS ${wav.rms.toFixed(4)} — no audible content`);
    });

    test(`${file} carries no dead air at the end`, () => {
      const wav = readWav(file);
      assert.ok(
        wav.seconds <= CEILING_SECONDS,
        `${file} runs ${wav.seconds.toFixed(2)}s, ceiling ${CEILING_SECONDS}s`
      );
      const silence = wav.seconds - wav.soundEndsAt;
      assert.ok(
        silence <= MAX_TRAILING_SILENCE,
        `${file} has ${silence.toFixed(3)}s of near-silence after the sound ends`
      );
    });
  }

  test("the effects are levelled against each other", () => {
    // The source packs are mastered at different levels; build-sounds.mjs
    // normalises every output to the same headroom. Without this, one effect
    // is startlingly louder than the rest.
    for (const file of requiredFiles()) {
      const { peak } = readWav(file);
      assert.ok(
        peak > 0.85 && peak <= 1.0,
        `${file} peaks at ${peak.toFixed(3)}, expected a normalised ~0.89`
      );
    }
  });
});
