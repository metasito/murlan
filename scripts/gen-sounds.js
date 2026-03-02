const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(__dirname, "..", "assets", "sounds");

function writeWav(filename, samples) {
  const numSamples = samples.length;
  const byteRate = SAMPLE_RATE * 2;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, buf);
  console.log(`  wrote ${filename} (${buf.length} bytes)`);
}

function envelope(t, attack, decay, sustain, release, totalDur) {
  if (t < attack) return t / attack;
  if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
  if (t < totalDur - release) return sustain;
  return sustain * (1 - (t - (totalDur - release)) / release);
}

function sine(freq, t) { return Math.sin(2 * Math.PI * freq * t); }
function square(freq, t) { return sine(freq, t) >= 0 ? 1 : -1; }
function triangle(freq, t) {
  const p = t * freq % 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

function makeSamples(dur, fn) {
  const n = Math.ceil(SAMPLE_RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    s[i] = fn(t, i, n);
  }
  return s;
}

function genCardSelect() {
  const dur = 0.09;
  return makeSamples(dur, (t, i, n) => {
    const env = envelope(t, 0.002, 0.03, 0.1, 0.04, dur);
    return triangle(1050, t) * env * 0.55 + sine(2100, t) * env * 0.18;
  });
}

function genCardPlay() {
  const dur = 0.18;
  return makeSamples(dur, (t, i, n) => {
    const env = envelope(t, 0.003, 0.06, 0.15, 0.08, dur);
    const thud = sine(160, t) * 0.7 + sine(320, t) * 0.3 + sine(80, t) * 0.2;
    const click = triangle(1600, t) * Math.exp(-t * 80) * 0.4;
    return (thud + click) * env * 0.7;
  });
}

function genCardPass() {
  const dur = 0.14;
  return makeSamples(dur, (t, i, n) => {
    const freq = 520 - (t / dur) * 240;
    const env = envelope(t, 0.004, 0.05, 0.2, 0.05, dur);
    return sine(freq, t) * env * 0.5 + sine(freq * 1.5, t) * env * 0.15;
  });
}

function genYourTurn() {
  const dur = 0.25;
  return makeSamples(dur, (t, i, n) => {
    const note1 = t < 0.12 ? sine(660, t) * Math.min(1, t / 0.01) * Math.exp(-(t - 0.01) * 12) : 0;
    const note2 = t >= 0.13 ? sine(880, t) * Math.min(1, (t - 0.13) / 0.01) * Math.exp(-(t - 0.14) * 10) : 0;
    return (note1 + note2) * 0.55;
  });
}

function genRoundStart() {
  const dur = 0.4;
  const notes = [440, 554, 660];
  return makeSamples(dur, (t) => {
    let out = 0;
    notes.forEach((freq, i) => {
      const start = i * 0.12;
      const end = start + 0.15;
      if (t >= start && t < end) {
        const lt = t - start;
        const env = Math.min(1, lt / 0.01) * Math.exp(-lt * 8);
        out += sine(freq, t) * env * 0.45;
      }
    });
    return out;
  });
}

function genRoundWin() {
  const dur = 0.6;
  const notes = [523, 659, 784, 1046];
  const timings = [0, 0.1, 0.2, 0.33];
  return makeSamples(dur, (t) => {
    let out = 0;
    notes.forEach((freq, i) => {
      const start = timings[i];
      if (t >= start) {
        const lt = t - start;
        const env = Math.min(1, lt / 0.01) * Math.exp(-lt * 5);
        out += sine(freq, t) * env * 0.38;
        out += sine(freq * 2, t) * env * 0.12;
      }
    });
    return Math.max(-1, Math.min(1, out));
  });
}

function genUrgentTick() {
  const dur = 0.05;
  return makeSamples(dur, (t) => {
    const env = Math.exp(-t * 80);
    return square(1400, t) * env * 0.6;
  });
}

function genBomb() {
  const dur = 0.35;
  return makeSamples(dur, (t) => {
    const env = envelope(t, 0.005, 0.1, 0.3, 0.15, dur);
    const rumble = sine(55, t) * 0.6 + sine(82, t) * 0.4 + sine(110, t) * 0.2 + sine(165, t) * 0.15;
    const crack = (Math.random() * 2 - 1) * Math.exp(-t * 20) * 0.3;
    return (rumble * env + crack) * 0.65;
  });
}

function genGameWin() {
  const dur = 1.0;
  const notes = [523, 659, 784, 659, 880, 1046];
  const timings = [0, 0.1, 0.2, 0.35, 0.45, 0.58];
  return makeSamples(dur, (t) => {
    let out = 0;
    notes.forEach((freq, i) => {
      const start = timings[i];
      const isLast = i === notes.length - 1;
      if (t >= start) {
        const lt = t - start;
        const decay = isLast ? 3 : 8;
        const env = Math.min(1, lt / 0.01) * Math.exp(-lt * decay);
        out += sine(freq, t) * env * 0.4;
        out += sine(freq * 2, t) * env * 0.08;
      }
    });
    return Math.max(-1, Math.min(1, out * 0.9));
  });
}

function genGameLose() {
  const dur = 0.6;
  const notes = [440, 370, 330, 220];
  const timings = [0, 0.12, 0.26, 0.42];
  return makeSamples(dur, (t) => {
    let out = 0;
    notes.forEach((freq, i) => {
      const start = timings[i];
      if (t >= start) {
        const lt = t - start;
        const env = Math.min(1, lt / 0.01) * Math.exp(-lt * 7);
        out += sine(freq, t) * env * 0.4;
        out += sine(freq * 0.5, t) * env * 0.1;
      }
    });
    return Math.max(-1, Math.min(1, out));
  });
}

function genDeal() {
  const dur = 0.2;
  return makeSamples(dur, (t) => {
    const noise = (Math.random() * 2 - 1);
    const env = Math.exp(-t * 18) * Math.min(1, t / 0.005);
    const flutter = sine(800 + (t / dur) * 400, t) * 0.3;
    return (noise * env * 0.5 + flutter * env * 0.4) * 0.6;
  });
}

function genExchange() {
  const dur = 0.3;
  return makeSamples(dur, (t) => {
    const env = envelope(t, 0.01, 0.1, 0.3, 0.1, dur);
    return (sine(528, t) * 0.5 + sine(660, t) * 0.25 + sine(792, t) * 0.12) * env * 0.55;
  });
}

console.log("Generating audio files...");
writeWav("card_select.mp3", genCardSelect());
writeWav("card_play.mp3", genCardPlay());
writeWav("card_pass.mp3", genCardPass());
writeWav("your_turn.mp3", genYourTurn());
writeWav("round_start.mp3", genRoundStart());
writeWav("round_win.mp3", genRoundWin());
writeWav("urgent_tick.mp3", genUrgentTick());
writeWav("bomb.mp3", genBomb());
writeWav("game_win.mp3", genGameWin());
writeWav("game_lose.mp3", genGameLose());
writeWav("deal.mp3", genDeal());
writeWav("exchange.mp3", genExchange());
console.log("Done.");
