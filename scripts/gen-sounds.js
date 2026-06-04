const fs = require("fs");
const path = require("path");

const SR = 44100;
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
  console.log(`  ${filename}  (${(n / SR * 1000).toFixed(0)} ms)`);
}

const π = Math.PI;
const sin = (f, t) => Math.sin(2 * π * f * t);
const exp = (x) => Math.exp(x);
const rng = () => Math.random() * 2 - 1;

function ms(dur_ms, fn) {
  const n = Math.ceil(SR * dur_ms / 1000);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = fn(i / SR, i, n);
  return s;
}

// Low-pass filter (one-pole IIR)
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

// Very short reverb: sum of decaying delays
function reverb(samples, roomMs, decay) {
  const out = new Float32Array(samples.length);
  const delays = [Math.floor(roomMs * 0.7 * SR / 1000),
                  Math.floor(roomMs * 1.0 * SR / 1000),
                  Math.floor(roomMs * 1.3 * SR / 1000)];
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    for (const d of delays) {
      if (i >= d) v += samples[i - d] * decay;
    }
    out[i] = v;
  }
  return out;
}

// ─── card_select — crisp "thip": plastic click, short attack ─────────────────
function genCardSelect() {
  const s = ms(70, (t) => {
    const click = sin(1400, t) * exp(-t * 120) * 0.5
                + sin(2800, t) * exp(-t * 180) * 0.2
                + rng() * exp(-t * 200) * 0.35;
    return click;
  });
  return lpf(s, 5000);
}

// ─── card_play — firm card slam: thud + high crack ────────────────────────────
function genCardPlay() {
  const s = ms(200, (t) => {
    const thud  = sin(140, t) * exp(-t * 22) * 0.6
                + sin(90,  t) * exp(-t * 15) * 0.35
                + sin(280, t) * exp(-t * 35) * 0.2;
    const crack = rng() * exp(-t * 90) * 0.5
                + sin(1800, t) * exp(-t * 120) * 0.15;
    const env   = Math.min(1, t / 0.003);
    return (thud + crack) * env * 0.75;
  });
  return reverb(s, 18, 0.12);
}

// ─── card_pass — airy whoosh ──────────────────────────────────────────────────
function genCardPass() {
  const dur = 0.18;
  const s = ms(180, (t) => {
    const peak = 0.04;
    const env  = t < peak ? t / peak : exp(-(t - peak) * 14);
    const freq = 600 - t * 1200;
    return (sin(freq, t) * 0.4 + rng() * 0.45) * env * 0.65;
  });
  return lpf(s, 4500);
}

// ─── your_turn — two bright chimes, E5 then B5 ────────────────────────────────
function genYourTurn() {
  return ms(380, (t) => {
    let out = 0;
    // E5 = 659 Hz
    if (t < 0.2) {
      const env = sin(π * t / 0.2);
      out += (sin(659, t) * 0.7 + sin(1318, t) * 0.2 + sin(1977, t) * 0.07) * env * 0.65;
    }
    // B5 = 988 Hz
    if (t >= 0.16) {
      const lt = t - 0.16;
      const env = sin(π * lt / 0.22) * exp(-lt * 4);
      out += (sin(988, lt) * 0.7 + sin(1976, lt) * 0.2 + sin(2964, lt) * 0.06) * env * 0.65;
    }
    return out;
  });
}

// ─── round_start — three rising casino-bell notes C5-E5-G5 ───────────────────
function genRoundStart() {
  const notes = [{ f: 523, t0: 0 }, { f: 659, t0: 0.15 }, { f: 784, t0: 0.3 }];
  return ms(650, (t) => {
    let out = 0;
    for (const n of notes) {
      if (t < n.t0) continue;
      const lt  = t - n.t0;
      const env = lt < 0.015 ? lt / 0.015 : exp(-lt * 5.5);
      out += (sin(n.f, lt) * 0.65 + sin(n.f * 2, lt) * 0.2 + sin(n.f * 3, lt) * 0.08) * env * 0.5;
    }
    return out;
  });
}

// ─── round_win — arpeggio C-E-G-C with warm shimmer ──────────────────────────
function genRoundWin() {
  const notes = [523, 659, 784, 1047];
  const times = [0, 0.12, 0.24, 0.36];
  return ms(800, (t) => {
    let out = 0;
    for (let i = 0; i < notes.length; i++) {
      if (t < times[i]) continue;
      const lt   = t - times[i];
      const tail = i === notes.length - 1 ? 3.5 : 7;
      const env  = lt < 0.012 ? lt / 0.012 : exp(-lt * tail);
      const f    = notes[i];
      out += (sin(f, lt) * 0.6 + sin(f * 2, lt) * 0.22 + sin(f * 3, lt) * 0.09 + sin(f * 0.5, lt) * 0.12) * env * 0.48;
    }
    return Math.max(-1, Math.min(1, out));
  });
}

// ─── urgent_tick — sharp metronome click ─────────────────────────────────────
function genUrgentTick() {
  return ms(45, (t) => {
    const env = exp(-t * 160);
    return (sin(1600, t) * 0.55 + sin(3200, t) * 0.2 + rng() * 0.25) * env;
  });
}

// ─── bomb — deep explosion: sub bass + noise punch ────────────────────────────
function genBomb() {
  const s = ms(500, (t) => {
    // Sub bass with pitch drop
    const pitch = 80 * exp(-t * 5);
    const bass  = (sin(pitch, t) * 0.7 + sin(pitch * 1.5, t) * 0.3) * exp(-t * 5);
    // Noise burst
    const noise = rng() * exp(-t * 12) * 0.65;
    // Sharp transient crack
    const crack = rng() * exp(-t * 80) * 0.5;
    const env   = Math.min(1, t / 0.004);
    return (bass + noise + crack) * env * 0.85;
  });
  return reverb(s, 40, 0.18);
}

// ─── game_win — full victory fanfare with chord sustain ──────────────────────
function genGameWin() {
  const arp   = [523, 659, 784, 1047];
  const arpT  = [0, 0.11, 0.22, 0.33];
  const chord = [523, 659, 784, 1047];
  return ms(1800, (t) => {
    let out = 0;
    // Arpeggio
    for (let i = 0; i < arp.length; i++) {
      if (t < arpT[i]) continue;
      const lt  = t - arpT[i];
      const env = lt < 0.01 ? lt / 0.01 : exp(-lt * 8);
      const f   = arp[i];
      out += (sin(f, lt) * 0.6 + sin(f * 2, lt) * 0.2 + sin(f * 3, lt) * 0.07) * env * 0.45;
    }
    // Chord bloom after 0.5 s
    if (t >= 0.5) {
      const lt  = t - 0.5;
      const env = lt < 0.04 ? lt / 0.04 : exp(-lt * 1.8);
      for (const f of chord) {
        out += (sin(f, lt) * 0.55 + sin(f * 2, lt) * 0.18 + sin(f * 0.5, lt) * 0.12) * env * 0.3;
      }
    }
    return Math.max(-1, Math.min(1, out));
  });
}

// ─── game_lose — descending "wah-wah" ─────────────────────────────────────────
function genGameLose() {
  const notes = [
    { f: 466, t0: 0,    len: 0.28 },
    { f: 415, t0: 0.24, len: 0.28 },
    { f: 370, t0: 0.5,  len: 0.45 },
  ];
  return ms(1100, (t) => {
    let out = 0;
    for (const n of notes) {
      if (t < n.t0 || t > n.t0 + n.len + 0.25) continue;
      const lt  = t - n.t0;
      const env = lt < 0.025 ? lt / 0.025 : exp(-lt * 4.5);
      out += (sin(n.f, lt) * 0.65 + sin(n.f * 2, lt) * 0.2 + sin(n.f * 0.5, lt) * 0.15) * env * 0.52;
    }
    return out;
  });
}

// ─── deal — rapid-fire card riffling sound ────────────────────────────────────
function genDeal() {
  const ticks = [0, 0.038, 0.076, 0.114, 0.152];
  const s = ms(280, (t) => {
    let out = 0;
    for (const t0 of ticks) {
      if (t < t0) continue;
      const lt  = t - t0;
      const env = lt < 0.003 ? lt / 0.003 : exp(-lt * 70);
      const f   = 900 + t0 * 300;
      out += (sin(f, lt) * 0.4 + rng() * 0.55) * env * 0.55;
    }
    return out;
  });
  return lpf(s, 6000);
}

// ─── exchange — coin-like shimmer + two clicks ────────────────────────────────
function genExchange() {
  return ms(320, (t) => {
    // Metallic shimmer
    const shimmer = (sin(1047, t) * 0.5 + sin(1319, t) * 0.3 + sin(1568, t) * 0.2)
                  * exp(-t * 9) * sin(π * t / 0.32) * 0.55;
    // Two quick card clicks
    const c1 = t >= 0.09 ? (rng() * exp(-(t - 0.09) * 120)) * 0.45 : 0;
    const c2 = t >= 0.19 ? (rng() * exp(-(t - 0.19) * 120)) * 0.45 : 0;
    return shimmer + c1 + c2;
  });
}

console.log("Generating sounds...");
writeWav("card_select.mp3", genCardSelect());
writeWav("card_play.mp3",   genCardPlay());
writeWav("card_pass.mp3",   genCardPass());
writeWav("your_turn.mp3",   genYourTurn());
writeWav("round_start.mp3", genRoundStart());
writeWav("round_win.mp3",   genRoundWin());
writeWav("urgent_tick.mp3", genUrgentTick());
writeWav("bomb.mp3",        genBomb());
writeWav("game_win.mp3",    genGameWin());
writeWav("game_lose.mp3",   genGameLose());
writeWav("deal.mp3",        genDeal());
writeWav("exchange.mp3",    genExchange());
console.log("Done.");
