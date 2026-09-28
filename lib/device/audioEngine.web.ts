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
const LATE_S = 0.01;
const LOOKAHEAD_S = 2;
const START_MARGIN_S = 0.05;
const GAIN_JITTER = 0.08;
const PITCH_JITTER = 0.04;
const BUSES: Bus[] = ["sfx", "sting", "music"];
const FILES = Object.keys(SOUND_FILES) as SoundFile[];
const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

interface Deck {
  track: TrackId;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  next: number;
  timer?: ReturnType<typeof setInterval>;
}

let ctx: AudioContext | null = null;
let bound = false;
let deck: Deck | null = null;
let wanted: TrackId | null = null;
const trims: Record<Bus, number> = { sfx: 1, sting: 1, music: 1 };
const nodes = {} as Record<Bus, { trim: GainNode; gain: GainNode }>;
const fetched = new Map<number, Promise<ArrayBuffer | null>>();
const decoded = new Map<number, Promise<AudioBuffer | null>>();
const buffers = new Map<SoundFile, AudioBuffer>();
const lastVoice = new Map<SoundId, AudioBufferSourceNode>();
const stats = { plays: 0, dropped: 0, rebuilds: 0 };

const jitter = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;

function fetchOnce(file: number): Promise<ArrayBuffer | null> {
  let bytes = fetched.get(file);
  if (!bytes) {
    bytes = fetch(file as unknown as string).then((r) => r.arrayBuffer()).catch(() => null);
    fetched.set(file, bytes);
  }
  return bytes;
}

function decode(c: AudioContext, file: number): Promise<AudioBuffer | null> {
  let buffer = decoded.get(file);
  if (!buffer) {
    // decodeAudioData detaches what it is given; the copy keeps the fetch reusable.
    buffer = fetchOnce(file).then((b) => (b ? c.decodeAudioData(b.slice(0)) : null)).catch(() => null);
    decoded.set(file, buffer);
  }
  return buffer;
}

function build(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  const c = new Ctor();
  for (const bus of BUSES) {
    const trim = c.createGain();
    const gain = c.createGain();
    trim.gain.value = trims[bus];
    gain.connect(trim);
    trim.connect(c.destination);
    nodes[bus] = { trim, gain };
  }
  for (const f of FILES) void decode(c, SOUND_FILES[f]()).then((b) => b && buffers.set(f, b));
  ctx = c;
  return c;
}

// Safari honours resume() only synchronously inside the gesture, so the context is built here and nowhere else.
function unlock(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  const c = build();
  if (!c) return;
  if (c.state !== "running") void c.resume();
  music(wanted);
}

export function startAudio(): Promise<void> {
  if (typeof document === "undefined" || bound) return Promise.resolve();
  bound = true;
  for (const e of ["pointerdown", "touchend", "keydown"]) document.addEventListener(e, unlock, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (ctx) void (document.hidden ? ctx.suspend() : ctx.resume());
  });
  return Promise.all(FILES.map((f) => fetchOnce(SOUND_FILES[f]()))).then(() => undefined);
}

function contextTime(c: AudioContext, at: number | undefined): number | null {
  if (at === undefined) return c.currentTime;
  const stamp = c.getOutputTimestamp?.();
  const t = stamp?.performanceTime
    ? (stamp.contextTime ?? 0) + (at - stamp.performanceTime) / 1000
    : c.currentTime + (at - performance.now()) / 1000;
  return t < c.currentTime - LATE_S ? null : Math.max(t, c.currentTime);
}

export function play(id: SoundId, o: { at?: number; gain?: number; bus?: Bus } = {}): void {
  const c = ctx;
  const spec = SOUNDS[id];
  const buffer = buffers.get(spec.file);
  const t = c && buffer && !document.hidden && c.state === "running" ? contextTime(c, o.at) : null;
  if (t === null || !c || !buffer) {
    stats.dropped++;
    return;
  }
  const source = c.createBufferSource();
  const gain = c.createGain();
  source.buffer = buffer;
  source.playbackRate.value = (spec.rate ?? 1) * (spec.vary ? jitter(PITCH_JITTER) : 1);
  gain.gain.value = Math.min(1, spec.gain * (o.gain ?? 1) * (spec.vary ? jitter(GAIN_JITTER) : 1));
  source.connect(gain);
  gain.connect(nodes[o.bus ?? "sfx"].gain);
  source.start(t);
  lastVoice.set(id, source);
  stats.plays++;
}

export function ramp(bus: Bus, gain: number, o: { at?: number; ms: number }): void {
  const c = ctx;
  if (!c) return;
  const t = contextTime(c, o.at) ?? c.currentTime;
  const param = nodes[bus].gain.gain;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
  param.linearRampToValueAtTime(gain, t + o.ms / 1000);
}

function retire(d: Deck, t: number, fade: number): void {
  if (d.timer) clearInterval(d.timer);
  d.gain.gain.cancelScheduledValues(t);
  d.gain.gain.setValueAtTime(d.gain.gain.value, t);
  d.gain.gain.linearRampToValueAtTime(0, t + fade);
  for (const s of d.sources) s.stop(t + fade);
}

export function music(track: TrackId | null, o: { crossfadeMs?: number; at?: number } = {}): void {
  wanted = track;
  const c = ctx;
  if (!c || (deck?.track ?? null) === track) return;
  const fade = (o.crossfadeMs ?? MUSIC_CROSSFADE_MS) / 1000;
  const t = contextTime(c, o.at) ?? c.currentTime;
  const old = deck;
  if (old) retire(old, t, fade);
  deck = null;
  if (track === null) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(nodes.music.gain);
  const d: Deck = { track, gain, sources: [], next: 0 };
  deck = d;
  for (const other of TRACK_IDS) if (other !== track && other !== old?.track) decoded.delete(TRACKS[other]());
  void decode(c, TRACKS[track]()).then((buffer) => {
    if (!buffer || deck !== d) return;
    d.next = Math.max(t, c.currentTime + START_MARGIN_S);
    gain.gain.setValueAtTime(0, d.next);
    gain.gain.linearRampToValueAtTime(1, d.next + fade);
    // Successive one-shots at computed times, not `loop = true` (#96): a timer only queues, never times.
    const pump = () => {
      while (d.next < c.currentTime + LOOKAHEAD_S) {
        const s = c.createBufferSource();
        s.buffer = buffer;
        s.connect(gain);
        s.onended = () => d.sources.splice(d.sources.indexOf(s), 1);
        s.start(d.next);
        d.sources.push(s);
        d.next += buffer.duration;
      }
    };
    pump();
    d.timer = setInterval(pump, (LOOKAHEAD_S / 2) * 1000);
  });
}

export function setBusTrim(bus: Bus, gain: number): void {
  trims[bus] = gain;
  if (ctx) nodes[bus].trim.gain.setTargetAtTime(gain, ctx.currentTime, START_MARGIN_S);
}

export function cut(id: SoundId, at?: number): void {
  const c = ctx;
  const source = lastVoice.get(id);
  if (!c || !source) return;
  try {
    source.stop(contextTime(c, at) ?? c.currentTime);
  } catch {}
}

export function durationMs(id: SoundId): number {
  const buffer = buffers.get(SOUNDS[id].file);
  return buffer ? (buffer.duration * 1000) / (SOUNDS[id].rate ?? 1) : 0;
}

export function audioState(): AudioState {
  const state = ctx?.state as string | undefined;
  if (state === "running") return "running";
  if (state === "closed") return "failed";
  return "suspended";
}

export function engineStats(): EngineStats {
  return { audioMs: ctx ? ctx.currentTime * 1000 : 0, ...stats, resident: TRACK_IDS.filter((t) => decoded.has(TRACKS[t]())).length };
}
