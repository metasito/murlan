// ─────────────────────────────────────────────────────────────────────────────
// Murlan sound generator — synthesizes all 12 SFX from scratch (DSP, no samples).
//
// Output format: WAV (PCM16, mono, 44.1kHz), NOT mp3: the generator, the
// files on disk, and the requires in lib/sounds.ts must all agree on this,
// or lib/sounds.ts silently loads mislabeled data. If you ever want real
// MP3s (smaller, but needs an encoder — ffmpeg/lame are native binaries not
// guaranteed to exist in the Replit build image), pipe this script's WAV
// output through one as a separate, documented step; do not introduce a
// silent extension mismatch.
//
// Determinism: every generator seeds its own PRNG from a hash of its sound
// name (mulberry32), so noise layers are reproducible across runs/machines —
// diff the WAV bytes and they will be identical — while still differing
// per-sound so nothing sounds machine-stamped-identical to its neighbors.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const SR = 22050; // 22.05 kHz is transparent for short SFX and halves bundle size
const OUT = path.join(__dirname, "..", "assets", "sounds");

function writeWav(filename, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, filename), buf);
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / n);
  console.log(
    `  ${filename.padEnd(16)} ${(n / SR * 1000).toFixed(0).padStart(5)} ms   ` +
    `peak ${peak.toFixed(3).padStart(6)}   rms ${rms.toFixed(3).padStart(6)}`
  );
}

// ─── Math / core helpers ───────────────────────────────────────────────────

const π = Math.PI;
const sin = (f, t) => Math.sin(2 * π * f * t);
const exp = (x) => Math.exp(x);

function ms(dur_ms, fn) {
  const n = Math.ceil(SR * dur_ms / 1000);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = fn(i / SR, i, n);
  return s;
}

// ─── Seeded RNG (deterministic per sound, so builds are reproducible) ──────

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; // uniform -1..1
  };
}

function makeRng(name) {
  return mulberry32(hashSeed(name));
}

// ─── Envelopes ───────────────────────────────────────────────────────────
// Percussive one-shots use a fast linear Attack into an exponential Decay
// (the "AD" of ADSR — the S/R stages only matter for held notes, and nothing
// here is held). Melodic notes get a slightly longer attack so the fundamental
// forms before decay starts. Both always ramp from 0, so there is never an
// abrupt buffer-start click.

function envAD(t, attackSec, decayRate) {
  if (t < 0) return 0;
  if (t < attackSec) return t / attackSec;
  return exp(-(t - attackSec) * decayRate);
}

// ─── Filters ────────────────────────────────────────────────────────────

// One-pole low-pass (RC-style IIR).
function lpf(samples, cutHz) {
  const rc = 1 / (2 * π * cutHz);
  const dt = 1 / SR;
  const a = dt / (rc + dt);
  let prev = 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    prev = prev + a * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

// Complementary one-pole high-pass (signal minus its own low-pass).
function hpf(samples, cutHz) {
  const low = lpf(samples, cutHz);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - low[i];
  return out;
}

// Chamberlin state-variable band-pass, with a per-sample frequency function
// so it can sweep (used for whooshes/cracks) as well as sit static.
function bandpassSweep(samples, freqFn, Q) {
  const q = 1 / Q;
  let low = 0, band = 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const freq = Math.min(freqFn(i / SR), SR * 0.24);
    const f = 2 * Math.sin(π * Math.max(freq, 20) / SR);
    const high = samples[i] - low - q * band;
    band += f * high;
    low += f * band;
    out[i] = band;
  }
  return out;
}
function bandpass(samples, freqHz, Q) {
  return bandpassSweep(samples, () => freqHz, Q);
}

// Very short reverb: sum of decaying delays — gives percussive hits a sense
// of the felt table without smearing their transient.
function reverb(samples, roomMs, decay) {
  const out = new Float32Array(samples.length);
  const delays = [
    Math.floor(roomMs * 0.7 * SR / 1000),
    Math.floor(roomMs * 1.0 * SR / 1000),
    Math.floor(roomMs * 1.3 * SR / 1000),
  ];
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    for (const d of delays) if (i >= d) v += samples[i - d] * decay;
    out[i] = v;
  }
  return out;
}

// ─── Shared melodic timbre ──────────────────────────────────────────────
// Every chime/fanfare/jingle in the game (your_turn, round_start, round_win,
// game_win, game_lose) is built from this one additive "bell" partial stack
// so they read as one instrument in one key (C major / A minor), not five
// unrelated blips.

function bell(freq, t, h2 = 0.24, h3 = 0.09) {
  return sin(freq, t) + sin(freq * 2, t) * h2 + sin(freq * 3, t) * h3;
}

function playNote(freq, t0, t, { attack = 0.006, decay = 5.5 } = {}) {
  if (t < t0) return 0;
  const lt = t - t0;
  return bell(freq, lt) * envAD(lt, attack, decay);
}

const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
  C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5,
};

// ─── Loudness normalization + soft limiter ─────────────────────────────
// A short percussive buffer's RMS is dominated by its decay tail, so we
// normalize to a target RMS per loudness *category* (not per-file peak) —
// that is what makes card_select and game_win feel "mixed together" instead
// of each shouting at its own arbitrary level. The soft (tanh) knee absorbs
// any transient that would otherwise clip once the RMS gain is applied.

function softLimit(x, ceiling) {
  const ax = Math.abs(x);
  if (ax <= ceiling) return x;
  const over = Math.tanh((ax - ceiling) / (1 - ceiling));
  return Math.sign(x) * (ceiling + (1 - ceiling) * over);
}

function fadeEdges(samples, fadeInMs, fadeOutMs) {
  const out = Float32Array.from(samples);
  const fi = Math.min(out.length, Math.round(SR * fadeInMs / 1000));
  const fo = Math.min(out.length, Math.round(SR * fadeOutMs / 1000));
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= i / fo;
  return out;
}

const LOUDNESS = {
  ui: 0.085,       // card_select, urgent_tick — must sit below everything else
  physical: 0.13,  // card_play, card_pass, deal, exchange
  impact: 0.155,   // bomb
  melodic: 0.19,   // your_turn, round_start, round_win, game_lose
  fanfare: 0.21,   // game_win — the single loudest cue in the game
};

function finalize(filename, samples, targetRMS) {
  const shaped = fadeEdges(samples, 2, 10);
  let sumSq = 0;
  for (let i = 0; i < shaped.length; i++) sumSq += shaped[i] * shaped[i];
  const rms = Math.sqrt(sumSq / shaped.length) || 1e-9;
  const gain = targetRMS / rms;
  const out = new Float32Array(shaped.length);
  for (let i = 0; i < shaped.length; i++) out[i] = softLimit(shaped[i] * gain, 0.92);
  writeWav(filename, out);
}

// ═══════════════════════════════════════════════════════════════════════
// Generators
// ═══════════════════════════════════════════════════════════════════════

// ─── card_select — crisp click: filtered-noise flick + tiny tonal partial ──
function genCardSelect() {
  const rng = makeRng("card_select");
  const dur = 130;
  const noise = ms(dur, () => rng());
  const noiseF = bandpass(noise, 2700, 2.2);
  return ms(dur, (t, i) => {
    const tone = (sin(1500, t) * 0.6 + sin(2950, t) * 0.22) * envAD(t, 0.0004, 170);
    return noiseF[i] * envAD(t, 0.0005, 150) * 0.6 + tone * 0.55;
  });
}

// ─── card_play — slap on felt: low thump body + swept noise crack ─────────
function genCardPlay() {
  const rng = makeRng("card_play");
  const dur = 190;
  const noise = ms(dur, () => rng());
  const crackF = bandpassSweep(noise, (t) => 2700 - t * 7000, 2.0);
  const s = ms(dur, (t, i) => {
    const thump = (sin(135, t) * 0.7 + sin(85, t) * 0.3) * envAD(t, 0.001, 20);
    const crack = crackF[i] * envAD(t, 0.0006, 85);
    return thump * 0.75 + crack * 0.55;
  });
  return reverb(s, 16, 0.1);
}

// ─── card_pass — airy whoosh: noise through a falling band-pass sweep ─────
function genCardPass() {
  const rng = makeRng("card_pass");
  const dur = 190;
  const noise = ms(dur, () => rng());
  const swept = bandpassSweep(noise, (t) => 3000 - t * 11000, 2.6);
  return ms(dur, (t, i) => {
    const env = t < 0.02 ? t / 0.02 : exp(-(t - 0.02) * 9);
    return swept[i] * env;
  });
}

// ─── your_turn — two-note bright chime, E5 → G5 ────────────────────────────
function genYourTurn() {
  const rng = makeRng("your_turn");
  return ms(390, (t) => {
    let out = 0;
    out += playNote(NOTE.E5, 0, t, { attack: 0.006, decay: 5.2 });
    out += playNote(NOTE.G5, 0.17 + rng() * 0.004, t, { attack: 0.006, decay: 4.4 });
    return out;
  });
}

// ─── round_start — quick riffle-shuffle swell + C5-E5-G5 chime ────────────
function genRoundStart() {
  const rng = makeRng("round_start");
  const dur = 580;
  const shuffleNoise = ms(dur, (t) => (t < 0.09 ? rng() : 0));
  const shuffleF = bandpassSweep(shuffleNoise, (t) => 4500 - t * 20000, 3.0);
  const notes = [[NOTE.C5, 0.09], [NOTE.E5, 0.23], [NOTE.G5, 0.37]];
  return ms(dur, (t, i) => {
    let out = shuffleF[i] * envAD(t, 0.005, 26) * 0.5;
    for (const [f, t0] of notes) out += playNote(f, t0, t, { attack: 0.006, decay: 5.0 });
    return out;
  });
}

// ─── round_win — ascending arpeggio C5-E5-G5-C6 ────────────────────────────
function genRoundWin() {
  const rng = makeRng("round_win");
  const notes = [[NOTE.C5, 0], [NOTE.E5, 0.12], [NOTE.G5, 0.24], [NOTE.C6, 0.36]];
  return ms(680, (t) => {
    let out = 0;
    for (const [f, t0] of notes) {
      const decay = f === NOTE.C6 ? 3.3 : 6.5;
      out += playNote(f, t0 + rng() * 0.003, t, { attack: 0.005, decay });
    }
    return out;
  });
}

// ─── urgent_tick — sharp metronome click ───────────────────────────────────
function genUrgentTick() {
  const rng = makeRng("urgent_tick");
  const dur = 90;
  const noise = ms(dur, () => rng());
  const noiseF = bandpass(noise, 3800, 2.5);
  return ms(dur, (t, i) => (noiseF[i] * 0.5 + sin(1700, t) * 0.45) * envAD(t, 0.0003, 150));
}

// ─── bomb — deep impact: pitch-dropping sub + noise crack + noise body ─────
function genBomb() {
  const rng = makeRng("bomb");
  const dur = 480;
  const noise = ms(dur, () => rng());
  const crackF = bandpassSweep(noise, (t) => 2200 - t * 3500, 1.6);
  const bodyF = lpf(noise, 220);
  const s = ms(dur, (t, i) => {
    const pitch = 78 * exp(-t * 5.5);
    const bass = (sin(pitch, t) * 0.7 + sin(pitch * 1.5, t) * 0.3) * envAD(t, 0.002, 5.2);
    const crack = crackF[i] * envAD(t, 0.0008, 95) * 0.6;
    const body = bodyF[i] * envAD(t, 0.003, 11) * 0.5;
    return bass + crack + body;
  });
  return reverb(s, 40, 0.16);
}

// ─── game_win — full fanfare: arpeggio then a sustained chord bloom ───────
function genGameWin() {
  const rng = makeRng("game_win");
  const arp = [[NOTE.C5, 0], [NOTE.E5, 0.11], [NOTE.G5, 0.22], [NOTE.C6, 0.33]];
  const chord = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
  return ms(1450, (t) => {
    let out = 0;
    for (const [f, t0] of arp) out += playNote(f, t0 + rng() * 0.002, t, { attack: 0.006, decay: 7 });
    if (t >= 0.5) {
      const lt = t - 0.5;
      const env = lt < 0.05 ? lt / 0.05 : exp(-lt * 1.55);
      for (const f of chord) out += bell(f, lt, 0.2, 0.08) * env * 0.3;
    }
    return out;
  });
}

// ─── game_lose — descending somber A4-E4-C4, resolving to the same tonic ──
// C4 that the win cues live on — sad, but still "in the room" musically.
function genGameLose() {
  const rng = makeRng("game_lose");
  const notes = [[NOTE.A4, 0], [NOTE.E4, 0.26], [NOTE.C4, 0.54]];
  return ms(780, (t) => {
    let out = 0;
    for (const [f, t0] of notes) out += playNote(f, t0 + rng() * 0.004, t, { attack: 0.02, decay: 3.6 });
    return out;
  });
}

// ─── deal — rapid-fire riffle flutter, five jittered noise ticks ──────────
function genDeal() {
  const rng = makeRng("deal");
  const dur = 380;
  const ticks = [0, 0.052, 0.104, 0.156, 0.208, 0.26].map((t0) => t0 + rng() * 0.006);
  const noise = ms(dur, () => rng());
  const noiseF = bandpass(noise, 2800, 2.4);
  return ms(dur, (t, i) => {
    let out = 0;
    for (const t0 of ticks) {
      if (t < t0) continue;
      const lt = t - t0;
      const env = lt < 0.0025 ? lt / 0.0025 : exp(-lt * 85);
      out += noiseF[i] * env * 0.6 + sin(950, lt) * env * 0.2;
    }
    return out;
  });
}

// ─── exchange — magical swap: shimmering high bell + two card clicks ─────
function genExchange() {
  const rng = makeRng("exchange");
  const dur = 480;
  const shimmer = [[NOTE.C6, 0], [1318.51 /* E6 */, 0.1]];
  const noise = ms(dur, () => rng());
  const clickF = bandpass(noise, 3200, 3.0);
  return ms(dur, (t, i) => {
    let out = 0;
    for (const [f, t0] of shimmer) out += playNote(f, t0, t, { attack: 0.01, decay: 4.2 }) * 0.55;
    for (const t0 of [0.09, 0.19]) {
      if (t < t0) continue;
      const lt = t - t0;
      out += clickF[i] * envAD(lt, 0.0004, 140) * 0.45;
    }
    return out;
  });
}

// ═══════════════════════════════════════════════════════════════════════

console.log("Generating sounds (WAV, 22.05kHz mono, seeded-deterministic DSP)...\n");
finalize("card_select.wav", genCardSelect(), LOUDNESS.ui);
finalize("card_play.wav",   genCardPlay(),   LOUDNESS.physical);
finalize("card_pass.wav",   genCardPass(),   LOUDNESS.physical);
finalize("your_turn.wav",   genYourTurn(),   LOUDNESS.melodic);
finalize("round_start.wav", genRoundStart(), LOUDNESS.melodic);
finalize("round_win.wav",   genRoundWin(),   LOUDNESS.melodic);
finalize("urgent_tick.wav", genUrgentTick(), LOUDNESS.ui);
finalize("bomb.wav",        genBomb(),       LOUDNESS.impact);
finalize("game_win.wav",    genGameWin(),    LOUDNESS.fanfare);
finalize("game_lose.wav",   genGameLose(),   LOUDNESS.melodic);
finalize("deal.wav",        genDeal(),       LOUDNESS.physical);
finalize("exchange.wav",    genExchange(),   LOUDNESS.physical);
console.log("\nDone.");
