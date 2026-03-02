import { Audio } from "expo-av";
import { Platform } from "react-native";

// ─── Web Audio API (synthesized tones for web) ────────────────────────────────

let _webCtx: AudioContext | null = null;

function getWebCtx(): AudioContext | null {
  if (Platform.OS !== "web") return null;
  try {
    if (!_webCtx) {
      const Ctor =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctor) _webCtx = new Ctor();
    }
    return _webCtx;
  } catch {
    return null;
  }
}

interface ToneNote {
  freq: number;
  startOffset: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

function playWebNotes(notes: ToneNote[]): void {
  const ctx = getWebCtx();
  if (!ctx) return;
  try {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, ctx.currentTime);
    master.connect(ctx.destination);

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g);
      g.connect(master);
      osc.type = note.type ?? "sine";
      osc.frequency.value = note.freq;
      const t0 = ctx.currentTime + note.startOffset;
      g.gain.setValueAtTime(note.gain ?? 1, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + note.duration);
      osc.start(t0);
      osc.stop(t0 + note.duration + 0.01);
    }
  } catch {}
}

function webCardSelect(): void {
  playWebNotes([{ freq: 900, startOffset: 0, duration: 0.07, type: "triangle" }]);
}
function webCardPlay(): void {
  playWebNotes([
    { freq: 220, startOffset: 0, duration: 0.08, type: "triangle", gain: 1.4 },
    { freq: 440, startOffset: 0, duration: 0.13, type: "sine", gain: 0.8 },
  ]);
}
function webCardPass(): void {
  playWebNotes([{ freq: 350, startOffset: 0, duration: 0.12, type: "sine", gain: 0.6 }]);
}
function webYourTurn(): void {
  playWebNotes([
    { freq: 660, startOffset: 0, duration: 0.1, type: "sine" },
    { freq: 880, startOffset: 0.12, duration: 0.15, type: "sine" },
  ]);
}
function webRoundStart(): void {
  playWebNotes([
    { freq: 440, startOffset: 0, duration: 0.12, type: "sine" },
    { freq: 554, startOffset: 0.13, duration: 0.12, type: "sine" },
    { freq: 660, startOffset: 0.26, duration: 0.22, type: "sine" },
  ]);
}
function webRoundWin(): void {
  playWebNotes([
    { freq: 523, startOffset: 0, duration: 0.15, type: "sine" },
    { freq: 659, startOffset: 0.08, duration: 0.15, type: "sine" },
    { freq: 784, startOffset: 0.16, duration: 0.28, type: "sine" },
    { freq: 1046, startOffset: 0.28, duration: 0.35, type: "sine", gain: 0.7 },
  ]);
}
function webUrgentTick(): void {
  playWebNotes([{ freq: 1400, startOffset: 0, duration: 0.05, type: "square", gain: 0.5 }]);
}

// ─── Native sounds (expo-av) ──────────────────────────────────────────────────

let soundCache: Record<string, Audio.Sound> = {};

async function loadSound(key: string, assetModule: number): Promise<Audio.Sound | null> {
  if (soundCache[key]) return soundCache[key];
  try {
    const { sound } = await Audio.Sound.createAsync(assetModule);
    soundCache[key] = sound;
    return sound;
  } catch {
    return null;
  }
}

async function playNative(
  key: string,
  assetModule: number,
  volume = 1.0,
  rate = 1.0
): Promise<void> {
  try {
    const sound = await loadSound(key, assetModule);
    if (!sound) return;
    await sound.setVolumeAsync(volume);
    await sound.setRateAsync(rate, true);
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function playCardSelect(): Promise<void> {
  if (Platform.OS === "web") { webCardSelect(); return; }
  await playNative("select", require("../assets/sounds/card_select.mp3"), 0.35, 1.0);
}

export async function playCardPlay(): Promise<void> {
  if (Platform.OS === "web") { webCardPlay(); return; }
  await playNative("play", require("../assets/sounds/card_play.mp3"), 0.9, 1.0);
}

export async function playCardPass(): Promise<void> {
  if (Platform.OS === "web") { webCardPass(); return; }
  await playNative("pass", require("../assets/sounds/card_pass.mp3"), 0.5, 1.0);
}

export async function playYourTurn(): Promise<void> {
  if (Platform.OS === "web") { webYourTurn(); return; }
  await playNative("your_turn", require("../assets/sounds/card_select.mp3"), 0.55, 1.6);
}

export async function playRoundStart(): Promise<void> {
  if (Platform.OS === "web") { webRoundStart(); return; }
  await playNative("round_start", require("../assets/sounds/card_play.mp3"), 0.65, 1.3);
}

export async function playRoundWin(): Promise<void> {
  if (Platform.OS === "web") { webRoundWin(); return; }
  await playNative("round_win", require("../assets/sounds/card_play.mp3"), 0.9, 0.75);
}

export async function playUrgentTick(): Promise<void> {
  if (Platform.OS === "web") { webUrgentTick(); return; }
  await playNative("urgent", require("../assets/sounds/card_select.mp3"), 0.45, 2.2);
}

export async function preloadSounds(): Promise<void> {
  if (Platform.OS === "web") {
    getWebCtx();
    return;
  }
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    await Promise.all([
      loadSound("select", require("../assets/sounds/card_select.mp3")),
      loadSound("play", require("../assets/sounds/card_play.mp3")),
      loadSound("pass", require("../assets/sounds/card_pass.mp3")),
    ]);
  } catch {}
}

export function unloadSounds(): void {
  Object.values(soundCache).forEach((s) => s.unloadAsync().catch(() => {}));
  soundCache = {};
}
