import { AppState } from "react-native";
import { AudioContext, AudioManager, decodeAudioData, type AudioBuffer, type AudioBufferSourceNode, type GainNode } from "react-native-audio-api";
import session from "@/modules/murlan-audio-session";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";
import { localFiles } from "./assetFiles";
import { SOUNDS, SOUND_FILES, type SoundFile, type SoundId } from "./soundAssets";
import { TRACKS, type TrackId } from "./musicTracks";

export type Bus = "sfx" | "sting" | "music";
export type AudioState = "running" | "suspended" | "failed";
export interface EngineStats {
  audioMs: number;
  plays: number;
  dropped: number;
  rebuilds: number;
  resident: number;
}

export const MUSIC_CROSSFADE_MS = 600;
const SAMPLE_RATE = 48000;
const RESIDENT_TRACKS = 2;
const FALLBACK_LATE_MS = 10;
const LEAD_TTL_MS = 1000;
const NUDGE_MS = 2000;
const GAIN_JITTER = 0.08;
const PITCH_JITTER = 0.04;
const TRIM_TAU_S = 0.05;
const WATCHDOG_MS = 500;
const WATCHDOG_MIN_ADVANCE_S = 0.25;
const BUSES: Bus[] = ["sfx", "sting", "music"];
const FILES = Object.keys(SOUND_FILES) as SoundFile[];
const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

interface Graph {
  ctx: AudioContext;
  buses: Record<Bus, { trim: GainNode; gain: GainNode }>;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startsAt: number;
  endsAt: number;
}

interface Deck extends Voice {
  track: TrackId;
}

let graph: Graph | null = null;
let boot: Promise<void> | null = null;
let rebuilding: Promise<void> | null = null;
let ready = false;
let failed = false;
let listening = false;
let lastNudge = -Infinity;
let deck: Deck | null = null;
let wanted: TrackId | null = null;
let retired: Voice[] = [];
let voices: Voice[] = [];
let lead = { ms: 0, lateMs: FALLBACK_LATE_MS, at: -Infinity };
const trims: Record<Bus, number> = { sfx: 1, sting: 1, music: 1 };
const effects = new Map<SoundFile, AudioBuffer>();
const trackUris = new Map<TrackId, string>();
const tracks = new Map<TrackId, AudioBuffer>();
const decoding = new Map<TrackId, Promise<void>>();
const lastVoice = new Map<SoundId, AudioBufferSourceNode>();
const stats = { plays: 0, dropped: 0, rebuilds: 0 };

const jitter = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;
const running = (g: Graph | null): g is Graph => g !== null && g.ctx.state === "running";

function build(): Graph {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const buses = {} as Graph["buses"];
  for (const bus of BUSES) {
    const trim = ctx.createGain();
    const gain = ctx.createGain();
    trim.gain.value = trims[bus];
    gain.connect(trim);
    trim.connect(ctx.destination);
    buses[bus] = { trim, gain };
  }
  return { ctx, buses };
}

async function resumeInto(g: Graph): Promise<boolean> {
  try {
    await g.ctx.resume();
  } catch {
    return false;
  }
  if (g.ctx.state !== "running") return false;
  session?.preferLowLatency();
  lead.at = -Infinity;
  return true;
}

function listen(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") void wake();
    else if (state === "background") sleep();
  });
}

function evict(keep: TrackId, room: number): void {
  for (const victim of tracks.keys()) {
    if (tracks.size <= room) break;
    if (victim !== keep && victim !== deck?.track && victim !== wanted) tracks.delete(victim);
  }
}

function load(track: TrackId): Promise<void> {
  if (tracks.has(track)) {
    const buffer = tracks.get(track)!;
    tracks.delete(track);
    tracks.set(track, buffer);
    return Promise.resolve();
  }
  let pending = decoding.get(track);
  if (!pending) {
    evict(track, RESIDENT_TRACKS - 1);
    pending = decodeAudioData(trackUris.get(track)!, SAMPLE_RATE)
      .then((buffer) => {
        tracks.set(track, buffer);
        evict(track, RESIDENT_TRACKS);
      })
      .finally(() => decoding.delete(track));
    decoding.set(track, pending);
  }
  return pending;
}

async function start(): Promise<void> {
  listen();
  try {
    AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "default", iosOptions: ["mixWithOthers"] });
    const old = graph;
    graph = null;
    await old?.ctx.close().catch(() => {});
    const g = build();
    graph = g;
    if (!(await resumeInto(g))) throw new Error("the audio context did not start");
    // A module id reaches the decoder as base64 over the bridge in an Android release; a file:// path decodes natively.
    const uris = await localFiles([...FILES.map((f) => SOUND_FILES[f]()), ...TRACK_IDS.map((t) => TRACKS[t]())]);
    const decoded = await Promise.all(uris.slice(0, FILES.length).map((uri) => decodeAudioData(uri, SAMPLE_RATE)));
    FILES.forEach((f, i) => effects.set(f, decoded[i]));
    TRACK_IDS.forEach((t, i) => trackUris.set(t, uris[FILES.length + i]));
    await Promise.all(TRACK_IDS.slice(0, RESIDENT_TRACKS).map(load));
    ready = true;
    failed = false;
  } catch {
    failed = true;
    return;
  }
  music(wanted);
}

export function startAudio(): Promise<void> {
  boot ??= start();
  return boot;
}

function rebuild(): Promise<void> {
  rebuilding ??= (async () => {
    const old = graph;
    graph = null;
    deck = null;
    retired = [];
    voices = [];
    lastVoice.clear();
    // Android opens the new output stream only once the old one is closed.
    await old?.ctx.close().catch(() => {});
    const g = build();
    if (!(await resumeInto(g))) {
      await g.ctx.close().catch(() => {});
      return;
    }
    graph = g;
    stats.rebuilds++;
    if (AppState.currentState === "background") return sleep();
    music(wanted);
  })().finally(() => {
    rebuilding = null;
  });
  return rebuilding;
}

async function wake(): Promise<void> {
  if (failed) {
    boot = null;
    return startAudio();
  }
  if (!ready) return;
  const g = graph;
  if (!g) return rebuild();
  await resumeInto(g);
  const before = g.ctx.currentTime;
  setTimeout(() => {
    if (graph !== g || AppState.currentState === "background") return;
    if (running(g) && g.ctx.currentTime - before >= WATCHDOG_MIN_ADVANCE_S) {
      for (const bus of BUSES) g.buses[bus].trim.gain.setValueAtTime(trims[bus], g.ctx.currentTime);
      music(wanted);
    } else void rebuild();
  }, WATCHDOG_MS);
}

function nudge(): void {
  const now = performance.now();
  if (boot === null || AppState.currentState !== "active" || now - lastNudge < NUDGE_MS) return;
  lastNudge = now;
  void wake();
}

function sleep(): void {
  const g = graph;
  if (!g) return;
  if (running(g)) {
    const now = g.ctx.currentTime;
    const unstarted = [...voices, ...(deck ? [deck] : [])].filter((v) => v.startsAt > now);
    for (const v of unstarted) {
      v.source.stop(now);
      v.source.buffer = null;
      v.gain.disconnect();
    }
    voices = voices.filter((v) => !unstarted.includes(v));
    if (deck && unstarted.includes(deck)) deck = null;
    for (const bus of BUSES) {
      g.buses[bus].gain.gain.cancelScheduledValues(now);
      g.buses[bus].gain.gain.setValueAtTime(1, now);
    }
  }
  void g.ctx.suspend().catch(() => {});
}

function sweep(now: number): void {
  const done = (v: Voice) => {
    if (v.endsAt > now) return false;
    v.source.buffer = null;
    v.gain.disconnect();
    return true;
  };
  voices = voices.filter((v) => !done(v));
  retired = retired.filter((v) => !done(v));
}

function outputLead(): { ms: number; lateMs: number } {
  const now = performance.now();
  if (now - lead.at > LEAD_TTL_MS) {
    const io = session?.ioBufferMs() ?? 0;
    lead = { ms: (session?.outputLatencyMs() ?? 0) + io / 2, lateMs: io > 0 ? io : FALLBACK_LATE_MS, at: now };
  }
  return lead;
}

// A sample reaches the speaker one output latency, plus half an IO buffer on average, after its context time.
function when(ctx: AudioContext, at: number | undefined): number | null {
  if (at === undefined) return ctx.currentTime;
  const { ms, lateMs } = outputLead();
  const ahead = at - performance.now();
  if (ahead < -lateMs) return null;
  return ctx.currentTime + Math.max(0, ahead - ms) / 1000;
}

export function play(id: SoundId, o: { at?: number; gain?: number; bus?: Bus } = {}): void {
  const g = graph;
  const spec = SOUNDS[id];
  const buffer = effects.get(spec.file);
  const t = running(g) && buffer ? when(g.ctx, o.at) : null;
  if (DIAGNOSTICS) {
    const leadMs = o.at === undefined ? 0 : outputLead().ms;
    diag({ k: "play", t: performance.now(), id, at: o.at ?? performance.now(), lead: leadMs, bus: o.bus ?? "sfx", dropped: t === null });
  }
  if (t === null || !g || !buffer) {
    stats.dropped++;
    if (!running(g)) nudge();
    return;
  }
  sweep(g.ctx.currentTime);
  const source = g.ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = (spec.rate ?? 1) * (spec.vary ? jitter(PITCH_JITTER) : 1);
  const voice = g.ctx.createGain();
  voice.gain.value = Math.min(1, spec.gain * (o.gain ?? 1) * (spec.vary ? jitter(GAIN_JITTER) : 1));
  source.connect(voice);
  voice.connect(g.buses[o.bus ?? "sfx"].gain);
  // No onEnded: a JS callback per effect is a bridge crossing per play; sweep() frees finished voices instead.
  source.start(t);
  voices.push({ source, gain: voice, startsAt: t, endsAt: t + buffer.duration / source.playbackRate.value });
  lastVoice.set(id, source);
  stats.plays++;
}

export function ramp(bus: Bus, gain: number, o: { at?: number; ms: number }): void {
  const g = graph;
  if (!running(g)) return;
  const now = g.ctx.currentTime;
  const t = Math.max(now, when(g.ctx, o.at) ?? now);
  const param = g.buses[bus].gain.gain;
  param.cancelAndHoldAtTime(t);
  param.linearRampToValueAtTime(gain, t + o.ms / 1000);
}

export function music(track: TrackId | null, o: { crossfadeMs?: number; at?: number } = {}): void {
  wanted = track;
  const g = graph;
  if (!running(g) || (deck?.track ?? null) === track) return;
  if (track !== null && !tracks.has(track)) {
    void load(track).then(() => {
      if (wanted === track) music(track, o);
    }, () => {});
    return;
  }
  const now = g.ctx.currentTime;
  const t = Math.max(now, when(g.ctx, o.at) ?? now);
  const fade = (o.crossfadeMs ?? MUSIC_CROSSFADE_MS) / 1000;
  sweep(now);
  if (deck) {
    deck.gain.gain.cancelAndHoldAtTime(t);
    deck.gain.gain.linearRampToValueAtTime(0, t + fade);
    deck.source.stop(t + fade);
    retired.push({ ...deck, endsAt: t + fade });
    deck = null;
  }
  if (track === null) return;
  void load(track);
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + fade);
  gain.connect(g.buses.music.gain);
  const source = g.ctx.createBufferSource();
  source.buffer = tracks.get(track)!;
  source.loop = true;
  source.connect(gain);
  source.start(t);
  deck = { track, gain, source, startsAt: t, endsAt: Infinity };
  if (DIAGNOSTICS) diag({ k: "music", t: performance.now(), track, at: o.at ?? performance.now() });
}

export function setBusTrim(bus: Bus, gain: number): void {
  trims[bus] = gain;
  const g = graph;
  if (running(g)) g.buses[bus].trim.gain.setTargetAtTime(gain, g.ctx.currentTime, TRIM_TAU_S);
}

export function cut(id: SoundId, at?: number): void {
  const g = graph;
  const source = lastVoice.get(id);
  if (!running(g) || !source) return;
  try {
    source.stop(Math.max(g.ctx.currentTime, when(g.ctx, at) ?? 0));
  } catch {}
}

export function durationMs(id: SoundId): number {
  const buffer = effects.get(SOUNDS[id].file);
  return buffer ? (buffer.duration * 1000) / (SOUNDS[id].rate ?? 1) : 0;
}

export function audioState(): AudioState {
  if (failed) return "failed";
  const g = graph;
  if (!g || !ready) return "suspended";
  return g.ctx.state === "running" ? "running" : g.ctx.state === "closed" ? "failed" : "suspended";
}

export function engineStats(): EngineStats {
  return { audioMs: graph ? graph.ctx.currentTime * 1000 : 0, ...stats, resident: tracks.size };
}
