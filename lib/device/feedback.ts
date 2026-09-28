import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeMutable } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { SETTINGS_KEY } from "@/lib/storageKeys";
import { traceOnset } from "@/lib/e2eTrace";
import { audioState, cut, durationMs, engineStats, music, play, ramp, setBusTrim, startAudio } from "./audioEngine";
import { pulse, setHapticsGate, tap, type TapHaptic } from "./hapticsEngine";
import { LANDING_PULSES, landingPulsesFor, mix, type Moment, type Played, type PulseStep } from "./moments";
import type { SoundId } from "./soundAssets";
import type { TrackId } from "./musicTracks";

export type { LandingKind, Moment, MomentKind, PulseStep } from "./moments";
export type { PulseStrength, TapHaptic } from "./hapticsEngine";
export { pulse as landingPulse } from "./hapticsEngine";
export { LANDING_PULSES, audioState, engineStats, landingPulsesFor };
export type UiFeedbackKind = TapHaptic | "seatFill" | "roomFull";

const STING_DUCK_GAIN = 0.355;
const STING_DUCK_IN_MS = 60;
const STING_DUCK_OUT_MS = 400;
const DEFAULT_MUSIC_VOLUME = 0.5;
const UI_SOUNDS = { seatFill: "seat_fill", roomFull: "room_full" } as const;

let soundVolume = 1;
let musicVolume = DEFAULT_MUSIC_VOLUME;
let hapticsOn = true;
let track: TrackId | null = null;
let stingEndsAt = 0;
let played: Played[] = [];
let pending: { moments: Moment[]; at?: number }[] = [];
const generation = makeMutable(0);
setBusTrim("music", musicVolume);

// Read before SettingsProvider mounts, so a stored "off" holds from the first tap (CONTEXT.md, Feedback master state).
AsyncStorage.getItem(SETTINGS_KEY)
  .then((raw) => {
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed?.hapticsEnabled === "boolean") setHapticsEnabled(parsed.hapticsEnabled);
  })
  .catch(() => {});

export function startFeedback(): Promise<void> {
  return startAudio();
}

// Effects of one commit run back to back, so a microtask gathers them into one event; timers cannot, they are faked in tests.
export function event(moments: Moment[], at?: number): void {
  if (moments.length === 0) return;
  if (pending.length === 0) void Promise.resolve().then(flush);
  pending.push({ moments, at });
}

function flush(): void {
  const now = performance.now();
  const batches = new Map<number | undefined, Moment[]>();
  for (const p of pending) batches.set(p.at, [...(batches.get(p.at) ?? []), ...p.moments]);
  pending = [];
  for (const [at, moments] of [...batches].sort((a, b) => (a[0] ?? now) - (b[0] ?? now))) fire(moments, at, now);
}

function trace(kind: "sound" | "haptic", name: string, at: number, now: number): void {
  if (at <= now) traceOnset(kind, name);
  else if (process.env.EXPO_PUBLIC_E2E_FAST === "1") setTimeout(() => traceOnset(kind, name), at - now);
}

// A given `at` goes through untouched, past or not: the engine drops what is more than one IO buffer late. Only an absent `at` means now.
function fire(moments: Moment[], at: number | undefined, now: number): void {
  const out = mix(moments, at ?? now, played);
  played = out.played;
  const lead = Math.max(0, ...out.haptics.map((h) => -h.atMs));
  const t0 = at ?? (lead > 0 ? now + lead : undefined);
  if (out.sound && soundVolume > 0) {
    play(out.sound.id, { at: t0, bus: out.sound.bus });
    trace("sound", out.sound.id, t0 ?? now, now);
    if (out.sound.bus === "sting") duck(out.sound.id, t0 ?? now);
  }
  if (!hapticsOn) return;
  for (const h of out.haptics) {
    const t = t0 === undefined ? undefined : t0 + h.atMs;
    tap(h.tap, t);
    trace("haptic", h.tap, t ?? now, now);
  }
}

function duck(id: SoundId, at: number): void {
  const end = at + durationMs(id);
  ramp("music", STING_DUCK_GAIN, { at, ms: STING_DUCK_IN_MS });
  ramp("music", 1, { at: end, ms: STING_DUCK_OUT_MS });
  stingEndsAt = Math.max(stingEndsAt, end);
}

export function runLandingPulses(steps: readonly PulseStep[]): void {
  "worklet";
  generation.value += 1;
  const mine = generation.value;
  for (const step of steps) {
    if (step.offsetMs <= 0) pulse(step.strength);
    else
      setTimeout(() => {
        if (generation.value === mine) pulse(step.strength);
      }, step.offsetMs);
  }
}

export function startLandingPulses(m: { cards: number; bomb: boolean; mine: boolean }): void {
  const steps = landingPulsesFor(m);
  scheduleOnUI(runLandingPulses, steps);
  if (!hapticsOn) return;
  const now = performance.now();
  for (const s of steps) trace("haptic", s.strength, now + s.offsetMs, now);
}

export function cancelLandingPulses(): void {
  scheduleOnUI(runLandingPulses, []);
}

export function uiFeedback(kind: UiFeedbackKind): void {
  if (kind === "seatFill" || kind === "roomFull") {
    if (soundVolume === 0) return;
    play(UI_SOUNDS[kind]);
    traceOnset("sound", UI_SOUNDS[kind]);
    return;
  }
  if (!hapticsOn) return;
  tap(kind);
  traceOnset("haptic", kind);
}

export function silence(id: "clockRunningOut"): void {
  cut(id);
}

export function backgroundMusic(next: TrackId): void {
  track = next;
  if (musicVolume > 0) music(next, { at: Math.max(performance.now(), stingEndsAt) });
}

export function setSoundVolume(v: number): void {
  soundVolume = Math.max(0, Math.min(1, v));
  setBusTrim("sfx", soundVolume);
  setBusTrim("sting", soundVolume);
}

export function setMusicVolume(v: number): void {
  const was = musicVolume;
  musicVolume = Math.max(0, Math.min(1, v));
  setBusTrim("music", musicVolume);
  if (musicVolume === 0) music(null);
  else if (was === 0 && track) music(track);
}

export function setHapticsEnabled(v: boolean): void {
  hapticsOn = v;
  setHapticsGate(v);
}

export function hapticsEnabled(): boolean {
  return hapticsOn;
}

export function resetFeedback(): void {
  pending = [];
  played = [];
  stingEndsAt = 0;
  track = null;
  setHapticsEnabled(true);
  setSoundVolume(1);
  musicVolume = DEFAULT_MUSIC_VOLUME;
  setBusTrim("music", musicVolume);
}
