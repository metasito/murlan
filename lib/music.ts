import { Platform } from "react-native";
import type { AudioPlayer } from "expo-audio";
import { onWebAudioUnlocked, sharedWebCtx } from "@/lib/sounds";

/**
 * Four loops, all one composition — Abstraction's *Retro Lounge*, CC0 (#113).
 * WebM Opus at 48 kHz: MP3 cannot loop seamlessly, and Safari has decoded WebM
 * Opus since 17.0 against Ogg Opus's 18.4 (#121). Each source loop was closed
 * with a 20 ms equal-power crossfade before encoding, so the join is continuous
 * by construction rather than by luck.
 *
 * Requires are behind functions so Metro can see them statically while the
 * bytes stay out of the initial payload — the web bundle's ceiling is ~1 MB
 * gzip and these are 1.5 MB on their own.
 */
const TRACKS = {
  menu: () => require("../assets/music/menu.webm") as number,
  hand: () => require("../assets/music/hand.webm") as number,
  cue: () => require("../assets/music/cue.webm") as number,
  final: () => require("../assets/music/final.webm") as number,
} as const;

export type MusicTrack = keyof typeof TRACKS;

/** Long enough not to click, short enough not to feel like a transition. */
const FADE_S = 0.6;
/** How far under a bomb or a manche ending the bed drops. */
const DUCK_GAIN = 0.25;
const DUCK_FADE_S = 0.12;
const NATIVE_FADE_STEPS = 12;

let _enabled = true;
let _volume = 0.5;
/** What should be playing, whether or not it can be yet. */
let _wanted: MusicTrack | null = null;
let _ducked = false;

export function musicEnabled(): boolean {
  return _enabled;
}

export function setMusicMasterEnabled(v: boolean): void {
  _enabled = v;
  if (!v) stopMusic();
  else if (_wanted) void playMusic(_wanted);
}

export function setMusicMasterVolume(v: number): void {
  _volume = Math.max(0, Math.min(1, v));
  applyVolume();
}

function targetGain(): number {
  return _enabled ? _volume * (_ducked ? DUCK_GAIN : 1) : 0;
}

// ─── Web ──────────────────────────────────────────────────────────────────────

const webBuffers: Partial<Record<MusicTrack, AudioBuffer>> = {};
let webGain: GainNode | null = null;
let webPlaying: MusicTrack | null = null;
let webSources: AudioBufferSourceNode[] = [];
let webNextStart = 0;
let webTimer: ReturnType<typeof setInterval> | null = null;
let webGeneration = 0;

/** Schedule this far ahead, and top up twice as often. */
const LOOKAHEAD_S = 2;

async function webBuffer(track: MusicTrack, ctx: AudioContext): Promise<AudioBuffer | null> {
  const cached = webBuffers[track];
  if (cached) return cached;
  try {
    const url = TRACKS[track]() as unknown as string;
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    webBuffers[track] = buffer;
    return buffer;
  } catch {
    return null;
  }
}

function stopWebSources(): void {
  for (const s of webSources) {
    try {
      s.stop();
      s.disconnect();
    } catch {}
  }
  webSources = [];
  if (webTimer) {
    clearInterval(webTimer);
    webTimer = null;
  }
}

/**
 * Successive one-shot nodes at computed times rather than `loop = true`, per
 * #96. Each node is scheduled against the context clock, so the join carries no
 * scheduling jitter — a timer only decides *when to queue the next one*, never
 * when it sounds.
 */
function scheduleWeb(ctx: AudioContext, buffer: AudioBuffer, generation: number): void {
  const pump = () => {
    if (generation !== webGeneration) return;
    while (webNextStart < ctx.currentTime + LOOKAHEAD_S) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(webGain!);
      source.onended = () => {
        webSources = webSources.filter((s) => s !== source);
      };
      source.start(webNextStart);
      webSources.push(source);
      webNextStart += buffer.duration;
    }
  };
  pump();
  webTimer = setInterval(pump, (LOOKAHEAD_S / 2) * 1000);
}

async function playWebMusic(track: MusicTrack): Promise<void> {
  const ctx = sharedWebCtx();
  // No gesture yet. `_wanted` is set, and the unlock listener starts it.
  if (!ctx) return;
  if (webPlaying === track && webSources.length) return;
  const buffer = await webBuffer(track, ctx);
  if (!buffer || _wanted !== track) return;

  if (!webGain) {
    webGain = ctx.createGain();
    // Load-bearing: HTMLMediaElement.volume is a no-op on iOS Safari, and this
    // is the only volume control that works there.
    webGain.gain.value = 0;
    webGain.connect(ctx.destination);
  }

  webGeneration++;
  stopWebSources();
  webPlaying = track;
  webNextStart = ctx.currentTime + 0.05;
  scheduleWeb(ctx, buffer, webGeneration);
  rampWeb(ctx, targetGain(), FADE_S);
}

function rampWeb(ctx: AudioContext, to: number, seconds: number): void {
  if (!webGain) return;
  const now = ctx.currentTime;
  webGain.gain.cancelScheduledValues(now);
  webGain.gain.setValueAtTime(webGain.gain.value, now);
  webGain.gain.linearRampToValueAtTime(to, now + seconds);
}

// ─── Native ───────────────────────────────────────────────────────────────────

const nativePlayers: Partial<Record<MusicTrack, AudioPlayer>> = {};
let nativePlaying: MusicTrack | null = null;
let nativeFade: ReturnType<typeof setInterval> | null = null;

/**
 * Native iOS has no music, deliberately.
 *
 * expo-audio plays through AVFoundation, and AVPlayer does not demux WebM at
 * all — Opus reaches it only in an MP4 container, and only from iOS 17. Android
 * has decoded Opus in WebM since 5.0, so it is the one native platform this
 * format serves. Web is unaffected: Safari 17 decodes WebM Opus, which is why
 * #121 chose this container over Ogg in the first place.
 *
 * Failing here rather than inside AVPlayer keeps it one documented branch
 * instead of a silent nothing on a device. Tracked as its own issue; the fix is
 * a second encode, not a format change, because changing it costs web Safari.
 */
const NATIVE_MUSIC_SUPPORTED = Platform.OS !== "ios";

function nativePlayer(track: MusicTrack): AudioPlayer | null {
  if (!NATIVE_MUSIC_SUPPORTED) return null;
  const cached = nativePlayers[track];
  if (cached) return cached;
  try {
    // Required here, not imported: web never needs it, and a module-level
    // import pulls the native module into every test graph that imports this
    // file — including the ones that mock lib/sounds precisely to avoid it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const { createAudioPlayer } = require("expo-audio") as typeof import("expo-audio");
    const player = createAudioPlayer(TRACKS[track]());
    player.loop = true;
    player.volume = 0;
    nativePlayers[track] = player;
    return player;
  } catch {
    return null;
  }
}

/** expo-audio has no volume-ramp API, so the ramp is stepped here. */
function fadeNative(player: AudioPlayer, to: number, ms: number, onDone?: () => void): void {
  if (nativeFade) clearInterval(nativeFade);
  const from = player.volume ?? 0;
  const step = ms / NATIVE_FADE_STEPS;
  let i = 0;
  nativeFade = setInterval(() => {
    i++;
    try {
      player.volume = from + (to - from) * (i / NATIVE_FADE_STEPS);
    } catch {}
    if (i >= NATIVE_FADE_STEPS) {
      if (nativeFade) clearInterval(nativeFade);
      nativeFade = null;
      onDone?.();
    }
  }, step);
}

function playNativeMusic(track: MusicTrack): void {
  const player = nativePlayer(track);
  if (!player) return;
  if (nativePlaying && nativePlaying !== track) {
    const old = nativePlayers[nativePlaying];
    if (old) {
      try {
        old.pause();
      } catch {}
    }
  }
  nativePlaying = track;
  try {
    player.play();
  } catch {}
  fadeNative(player, targetGain(), FADE_S * 1000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts a loop, or does nothing if it is already the one playing. Safe to call
 * before the first gesture: the request is remembered and honoured at unlock.
 */
export async function playMusic(track: MusicTrack): Promise<void> {
  _wanted = track;
  if (!_enabled) return;
  if (Platform.OS === "web") await playWebMusic(track);
  else playNativeMusic(track);
}

// `_wanted` deliberately survives: silencing the bed does not change which
// track the current route asks for, and re-enabling music has nothing else to
// restart from. `unloadMusic` is the teardown that forgets it.
export function stopMusic(): void {
  if (Platform.OS === "web") {
    const ctx = sharedWebCtx();
    if (ctx && webGain) rampWeb(ctx, 0, FADE_S);
    webGeneration++;
    // Let the fade finish before the nodes go, or stopping is its own click.
    setTimeout(stopWebSources, FADE_S * 1000 + 50);
    webPlaying = null;
    return;
  }
  const player = nativePlaying ? nativePlayers[nativePlaying] : null;
  const stopping = nativePlaying;
  nativePlaying = null;
  if (player) {
    fadeNative(player, 0, FADE_S * 1000, () => {
      // Only pause if nothing else claimed the deck during the fade.
      if (nativePlaying !== stopping) {
        try {
          player.pause();
        } catch {}
      }
    });
  }
}

/** Drops the bed under a bomb or a manche ending, and brings it back. */
export function duckMusic(on: boolean): void {
  if (_ducked === on) return;
  _ducked = on;
  applyVolume(DUCK_FADE_S);
}

let duckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ducks for a moment and comes back on its own. Overlapping calls extend the
 * dip rather than each scheduling their own release, so a bomb during a manche
 * ending does not surface the music between the two.
 */
export function cancelMusicDuck(): void {
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  _ducked = false;
}

export function duckMusicFor(ms: number): void {
  duckMusic(true);
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    duckMusic(false);
  }, ms);
}

function applyVolume(seconds = 0.15): void {
  if (Platform.OS === "web") {
    const ctx = sharedWebCtx();
    if (ctx && webGain) rampWeb(ctx, targetGain(), seconds);
    return;
  }
  const player = nativePlaying ? nativePlayers[nativePlaying] : null;
  if (player) fadeNative(player, targetGain(), seconds * 1000);
}

export function unloadMusic(): void {
  stopWebSources();
  webGeneration++;
  // Both are the reason a torn-down module can still be holding the event loop.
  if (nativeFade) {
    clearInterval(nativeFade);
    nativeFade = null;
  }
  if (duckTimer) {
    clearTimeout(duckTimer);
    duckTimer = null;
  }
  _wanted = null;
  _ducked = false;
  for (const key of Object.keys(nativePlayers) as MusicTrack[]) {
    try {
      nativePlayers[key]?.remove();
    } catch {}
    delete nativePlayers[key];
  }
  nativePlaying = null;
  webPlaying = null;
}

if (Platform.OS === "web") {
  onWebAudioUnlocked(() => {
    if (_wanted && _enabled) void playWebMusic(_wanted);
  });
}
