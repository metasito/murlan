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
// #178 added a second container for iOS: the same audio, losslessly re-encoded
// to ALAC in M4A (assets/music/README.md has the "why" — the two containers
// that stayed lossy both measured a click on at least one track). Chromium
// cannot decode ALAC at all (neither decodeAudioData nor <audio> — verified as
// part of #178), so the two containers get two different checks below: the
// waveform arithmetic for WebM, and a header-only structural check for M4A
// that leans on ALAC's losslessness rather than re-deriving the same
// arithmetic against audio nothing here can decode.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const musicDir = path.resolve(__dirname, "..", "..", "assets", "music");

/** The four tracks; tests/musicAssets.test.ts pins these against what
 * lib/musicTracks.ts and lib/musicTracks.ios.ts actually require. */
const TRACKS = ["menu", "hand", "cue"] as const;

// ─── WebM: decode and measure the waveform ─────────────────────────────────────

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
        samples: n,
      };
    }
    return out;
  }, encoded);
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

// ─── M4A (ALAC): no decoder available, so read the container header instead ───
//
// This proves less than the WebM check above, and stays honest about the
// difference: the header can confirm the file is the right shape — right
// codec, right rate, right channel count, the same sample count as the
// matching WebM source, and not a silent stub of that length — but it never
// looks at a single decoded sample. A file that is the right length and the
// right average loudness but wrong in between (a faded-out seam, say) still
// passes every check here. Closing that gap means decoding ALAC, which
// nothing available to this suite can do — see assets/music/README.md,
// "What 'verified' means here, and what it does not".

interface Mp4Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

function readBoxes(buf: Buffer, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let off = start;
  while (off < end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    let headerSize = 8;
    if (size === 1) {
      const hi = buf.readUInt32BE(off + 8);
      const lo = buf.readUInt32BE(off + 12);
      size = hi * 2 ** 32 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = end - off;
    }
    boxes.push({ type, start: off, headerSize, size });
    off += size;
  }
  return boxes;
}

function findBox(boxes: Mp4Box[], type: string): Mp4Box {
  const box = boxes.find((b) => b.type === type);
  if (!box) throw new Error(`no ${type} box`);
  return box;
}

interface Mp4AudioInfo {
  codec: string;
  channelCount: number;
  sampleRate: number;
  samples: number;
}

/**
 * Reads just enough of an MP4/M4A's `moov` tree — `mdhd` for the sample count,
 * `stsd` for the codec and format — to check an ALAC file's shape without a
 * decoder. Both are plain ISO/IEC 14496-12 boxes; nothing here is ALAC-specific.
 */
function readMp4AudioInfo(buf: Buffer): Mp4AudioInfo {
  const moov = findBox(readBoxes(buf, 0, buf.length), "moov");
  const moovBoxes = readBoxes(buf, moov.start + moov.headerSize, moov.start + moov.size);
  const trak = findBox(moovBoxes, "trak");
  const trakBoxes = readBoxes(buf, trak.start + trak.headerSize, trak.start + trak.size);
  const mdia = findBox(trakBoxes, "mdia");
  const mdiaBoxes = readBoxes(buf, mdia.start + mdia.headerSize, mdia.start + mdia.size);

  const mdhd = findBox(mdiaBoxes, "mdhd");
  const mdhdOff = mdhd.start + mdhd.headerSize;
  const version = buf.readUInt8(mdhdOff);
  const timescale = version === 1 ? buf.readUInt32BE(mdhdOff + 20) : buf.readUInt32BE(mdhdOff + 12);
  const duration =
    version === 1
      ? Number(buf.readBigUInt64BE(mdhdOff + 24))
      : buf.readUInt32BE(mdhdOff + 16);

  const minf = findBox(mdiaBoxes, "minf");
  const minfBoxes = readBoxes(buf, minf.start + minf.headerSize, minf.start + minf.size);
  const stbl = findBox(minfBoxes, "stbl");
  const stblBoxes = readBoxes(buf, stbl.start + stbl.headerSize, stbl.start + stbl.size);
  const stsd = findBox(stblBoxes, "stsd");
  // stsd body: version(1) + flags(3) + entry_count(4), then the first sample entry.
  const entryStart = stsd.start + stsd.headerSize + 8;
  const codec = buf.toString("ascii", entryStart + 4, entryStart + 8);
  // AudioSampleEntry: [size(4) format(4) reserved(6) data_ref_idx(2)] then
  // [reserved(8) channelcount(2) samplesize(2) predefined(2) reserved(2) samplerate(4, 16.16)].
  const audioFieldsOff = entryStart + 16 + 8;
  const channelCount = buf.readUInt16BE(audioFieldsOff);
  const sampleRate = buf.readUInt32BE(audioFieldsOff + 8) / 65536;

  // `timescale` on an audio track is conventionally the sample rate, which
  // makes `duration` a sample count directly — true for every ALAC file ffmpeg
  // writes, and asserted below rather than assumed.
  return { codec, channelCount, sampleRate, samples: timescale === sampleRate ? duration : NaN };
}

test("the M4A (ALAC) files match the WebM files sample-for-sample", () => {
  for (const track of TRACKS) {
    const info = readMp4AudioInfo(readFileSync(path.join(musicDir, `${track}.m4a`)));
    const webm = measured[track];

    expect(info.codec, `${track}.m4a is not ALAC — re-encode with -c:a alac`).toBe("alac");
    expect(info.sampleRate, `${track}.m4a is not 48 kHz`).toBe(48000);
    expect(info.channelCount, `${track}.m4a is not stereo`).toBe(2);

    // The load-bearing check — see assets/music/README.md, "Why ALAC", for why
    // a mismatch here means the file was cut wrong rather than trimmed.
    expect(
      info.samples,
      `${track}.m4a holds ${info.samples} samples against ${webm.samples} in ${track}.webm — ` +
        `not the same audio, or trimmed differently`
    ).toBe(webm.samples);
  }
});

// The floor for the check above. A header-only read cannot tell real audio
// from a silent stub of the same declared sample count, so it needs its own
// signal: near-silent ALAC compresses close to nothing, while every real
// track here runs at least 1.2 bytes/sample (measured on the committed
// files). 0.3 sits well below the real floor and two orders of magnitude
// above a 12 KB silent stub at this sample count.
test("the M4A files are not a silent stub of the right length", () => {
  for (const track of TRACKS) {
    const path4a = path.join(musicDir, `${track}.m4a`);
    const bytes = readFileSync(path4a);
    const bytesPerSample = bytes.length / readMp4AudioInfo(bytes).samples;
    expect(
      bytesPerSample,
      `${track}.m4a compresses to ${bytesPerSample.toFixed(3)} bytes/sample — ` +
        `that is what near-silence looks like under ALAC, not music`
    ).toBeGreaterThan(0.3);
  }
});
