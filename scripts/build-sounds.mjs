// Rebuilds assets/sounds/ — the twelve effects lib/sounds.ts plays.
//
//   node scripts/build-sounds.mjs
//
// Real recordings rather than synthesis: Kenney's Casino Audio for anything a
// hand of cards does, and Kenney's Interface Sounds for the stings. Both are
// CC0 — see assets/sounds/README.md.
//
// Sources are downloaded rather than vendored, and the recipes below are the
// only thing this repository actually asserts about the result.
//
// Output is 44.1 kHz mono MP3, encoded with lamejs (pure JS — no native
// binary, no WASM build step, so this needs nothing beyond `npm install` to
// run). MP3, not OGG: the casino pack ships OGG and iOS will not play it.
// MP3 decodes natively on iOS, Android and every browser, so lib/sounds.ts
// needs no per-platform format branch. The names must match lib/sounds.ts
// exactly.
//
// Mixing runs in Chromium's OfflineAudioContext (via Playwright, already a
// devDependency) because there is no ffmpeg here and it gives decoding,
// gain, pitch and overlap for free. Encoding to MP3 happens afterwards, in
// plain Node, from the same normalised PCM the OfflineAudioContext produced.
import { chromium } from "playwright";
import lamejs from "@breezystack/lamejs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 96 kbps CBR mono is the standard "near-transparent" tier for short,
// percussive effects like these (no sustained tones or music to expose a
// low bitrate's artifacts), and cuts the twelve WAVs' 843 KB to under 130 KB.
const MP3_BITRATE_KBPS = 96;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "sounds");

const CASINO =
  "https://raw.githubusercontent.com/iwenzhou/kenney/master/Audio%20(295%20files)/Casino%20sounds%20(50%20sounds)";
const UI =
  "https://raw.githubusercontent.com/Calinou/kenney-interface-sounds/master/addons/kenney_interface_sounds";

const src = (name) =>
  name.endsWith(".ogg") ? `${CASINO}/${name}` : `${UI}/${name}`;

// `at` is seconds from the start, `rate` is playback rate (and therefore pitch:
// 1.26 and 1.5 are a major third and a fifth, so the win sting is a chord
// arpeggiated rather than three copies of the same note).
const RECIPES = {
  // ── Cards ──────────────────────────────────────────────────────────────────
  card_select: [{ file: "cardSlide3.ogg", gain: 0.75 }],
  card_play: [{ file: "cardPlace2.ogg", gain: 1.0 }],
  card_pass: [{ file: "cardShove2.ogg", gain: 0.7 }],
  deal: [{ file: "cardShuffle.ogg", gain: 1.0 }],
  exchange: [
    { file: "cardSlide6.ogg", gain: 0.9 },
    { file: "cardSlide2.ogg", gain: 0.75, at: 0.18 },
  ],
  round_start: [{ file: "cardFan1.ogg", gain: 0.9 }],

  // ── Table events ───────────────────────────────────────────────────────────
  your_turn: [{ file: "bong_001.wav", gain: 0.55 }],
  urgent_tick: [{ file: "tick_002.wav", gain: 0.8 }],

  // A bomb is the biggest play in the game: a hard chip clatter with a card
  // shove under it, so it lands as an impact rather than a click.
  bomb: [
    { file: "chipsCollide1.ogg", gain: 1.0 },
    { file: "cardShove4.ogg", gain: 0.6, at: 0.01 },
    { file: "drop_004.wav", gain: 0.5, at: 0.0 },
  ],

  // ── Stings ─────────────────────────────────────────────────────────────────
  round_win: [{ file: "confirmation_001.wav", gain: 0.8 }],

  // Rising major triad — the pack has no jingle, so one is built from a single
  // struck note resampled to three pitches.
  game_win: [
    { file: "glass_002.wav", gain: 0.75, rate: 1.0, at: 0.0 },
    { file: "glass_002.wav", gain: 0.75, rate: 1.26, at: 0.11 },
    { file: "glass_002.wav", gain: 0.8, rate: 1.5, at: 0.22 },
    { file: "confirmation_002.wav", gain: 0.5, at: 0.3 },
  ],

  // Falling minor third: the same idea, downward.
  game_lose: [
    { file: "glass_002.wav", gain: 0.5, rate: 0.84, at: 0.0 },
    { file: "glass_002.wav", gain: 0.5, rate: 0.67, at: 0.13 },
    { file: "error_003.wav", gain: 0.45, at: 0.05 },
  ],
};

// Trim silence, never sound. The cut point is the last moment the signal is
// still above an absolute floor — 55 dB below the file's own peak, which is
// inaudible under any other sound in the game — plus a short fade so the cut is
// not a click.
//
// The floor is absolute rather than a proportion of total energy, because a
// proportional measure is not idempotent: removing the quiet tail shrinks the
// total it is a proportion of, so each rebuild would cut further into the
// sound. This criterion gives the same answer on an already-trimmed file.
const SILENCE_FLOOR_DB = -55;
const WINDOW_SECONDS = 0.01;
const FADE = 0.06;

const files = [...new Set(Object.values(RECIPES).flat().map((s) => s.file))];

console.log(`Fetching ${files.length} source clips…`);
const encoded = {};
for (const f of files) {
  const res = await fetch(src(f));
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  encoded[f] = Buffer.from(await res.arrayBuffer()).toString("base64");
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const results = await page.evaluate(
  async ({ encoded, RECIPES, SILENCE_FLOOR_DB, WINDOW_SECONDS, FADE }) => {
    const SR = 44100;
    const bytes = (b64) =>
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

    const ctx = new AudioContext({ sampleRate: SR });
    const decoded = {};
    for (const [name, b64] of Object.entries(encoded)) {
      decoded[name] = await ctx.decodeAudioData(bytes(b64));
    }

    const out = {};
    for (const [name, layers] of Object.entries(RECIPES)) {
      const natural = Math.max(
        ...layers.map((l) => (l.at ?? 0) + decoded[l.file].duration / (l.rate ?? 1))
      );
      // A little tail so a release is never clipped off.
      const off = new OfflineAudioContext(1, Math.ceil((natural + 0.12) * SR), SR);
      for (const l of layers) {
        const node = off.createBufferSource();
        node.buffer = decoded[l.file];
        node.playbackRate.value = l.rate ?? 1;
        const gain = off.createGain();
        gain.gain.value = l.gain ?? 1;
        node.connect(gain).connect(off.destination);
        node.start(l.at ?? 0);
      }
      const rendered = await off.startRendering();
      const full = rendered.getChannelData(0);

      // Find the last window still above the floor, then fade out from there
      // and drop the silence that follows.
      let peakAbs = 0;
      for (let i = 0; i < full.length; i++) peakAbs = Math.max(peakAbs, Math.abs(full[i]));
      const floor = peakAbs * Math.pow(10, SILENCE_FLOOR_DB / 20);
      const win = Math.max(1, Math.round(WINDOW_SECONDS * SR));
      let end = 0;
      for (let start = 0; start < full.length; start += win) {
        let sum = 0;
        const stop = Math.min(full.length, start + win);
        for (let i = start; i < stop; i++) sum += full[i] * full[i];
        if (Math.sqrt(sum / (stop - start)) > floor) end = stop;
      }
      const fadeLen = Math.round(FADE * SR);
      const keep = Math.min(full.length, end + fadeLen);
      const pcm = full.slice(0, keep);
      for (let i = 0; i < fadeLen; i++) {
        const j = keep - fadeLen + i;
        if (j >= 0 && j < pcm.length) pcm[j] *= 1 - i / fadeLen;
      }

      // Normalise to a consistent headroom so no effect is jarringly louder
      // than its neighbours — the packs are mastered at different levels.
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
      const norm = peak > 0 ? 0.89 / peak : 1;

      // Raw 16-bit PCM, no container — the MP3 encoding happens back in Node.
      const n = pcm.length;
      const buf = new ArrayBuffer(n * 2);
      const view = new DataView(buf);
      for (let i = 0; i < n; i++) {
        const v = Math.max(-1, Math.min(1, pcm[i] * norm));
        view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      let bin = "";
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      out[name] = { pcm: btoa(bin), seconds: +(n / SR).toFixed(3) };
    }
    return out;
  },
  { encoded, RECIPES, SILENCE_FLOOR_DB, WINDOW_SECONDS, FADE }
);

await browser.close();

const SR = 44100;
const MP3_BLOCK = 1152; // lamejs encodes one MP3 frame per call at this size.

let total = 0;
for (const [name, { pcm, seconds }] of Object.entries(results)) {
  const raw = Buffer.from(pcm, "base64");
  const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);

  const encoder = new lamejs.Mp3Encoder(1, SR, MP3_BITRATE_KBPS);
  const chunks = [];
  for (let i = 0; i < samples.length; i += MP3_BLOCK) {
    const block = encoder.encodeBuffer(samples.subarray(i, i + MP3_BLOCK));
    if (block.length > 0) chunks.push(Buffer.from(block));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));
  const mp3 = Buffer.concat(chunks);

  writeFileSync(path.join(OUT, `${name}.mp3`), mp3);
  total += mp3.length;
  console.log(`${name}.mp3  ${seconds}s  ${(mp3.length / 1024).toFixed(1)} KB`);
}
console.log(`\n${Object.keys(results).length} files, ${(total / 1024).toFixed(0)} KB total`);
