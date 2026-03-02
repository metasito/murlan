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

function playWebNotes(notes: ToneNote[], masterGain = 0.18): void {
  const ctx = getWebCtx();
  if (!ctx) return;
  try {
    const master = ctx.createGain();
    master.gain.setValueAtTime(masterGain, ctx.currentTime);
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
  playWebNotes([{ freq: 1050, startOffset: 0, duration: 0.07, type: "triangle", gain: 0.8 }]);
}
function webCardPlay(): void {
  playWebNotes([
    { freq: 160, startOffset: 0, duration: 0.1, type: "sine", gain: 1.6 },
    { freq: 320, startOffset: 0, duration: 0.1, type: "sine", gain: 0.8 },
    { freq: 1600, startOffset: 0, duration: 0.03, type: "triangle", gain: 0.5 },
  ], 0.22);
}
function webCardPass(): void {
  playWebNotes([
    { freq: 520, startOffset: 0, duration: 0.08, type: "sine", gain: 0.7 },
    { freq: 350, startOffset: 0.05, duration: 0.09, type: "sine", gain: 0.5 },
  ]);
}
function webYourTurn(): void {
  playWebNotes([
    { freq: 660, startOffset: 0, duration: 0.1, type: "sine", gain: 1.0 },
    { freq: 880, startOffset: 0.12, duration: 0.15, type: "sine", gain: 0.9 },
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
  playWebNotes([{ freq: 1400, startOffset: 0, duration: 0.05, type: "square", gain: 0.6 }]);
}
function webBomb(): void {
  playWebNotes([
    { freq: 55, startOffset: 0, duration: 0.25, type: "sine", gain: 1.8 },
    { freq: 82, startOffset: 0, duration: 0.2, type: "sine", gain: 1.2 },
    { freq: 110, startOffset: 0, duration: 0.15, type: "sine", gain: 0.8 },
  ], 0.25);
}
function webGameWin(): void {
  playWebNotes([
    { freq: 523, startOffset: 0, duration: 0.1, type: "sine" },
    { freq: 659, startOffset: 0.1, duration: 0.1, type: "sine" },
    { freq: 784, startOffset: 0.2, duration: 0.1, type: "sine" },
    { freq: 659, startOffset: 0.35, duration: 0.1, type: "sine" },
    { freq: 880, startOffset: 0.45, duration: 0.12, type: "sine" },
    { freq: 1046, startOffset: 0.58, duration: 0.4, type: "sine", gain: 0.8 },
  ], 0.2);
}
function webGameLose(): void {
  playWebNotes([
    { freq: 440, startOffset: 0, duration: 0.12, type: "sine" },
    { freq: 370, startOffset: 0.13, duration: 0.12, type: "sine" },
    { freq: 330, startOffset: 0.27, duration: 0.12, type: "sine" },
    { freq: 220, startOffset: 0.42, duration: 0.3, type: "sine", gain: 0.7 },
  ]);
}
function webDeal(): void {
  playWebNotes([
    { freq: 900, startOffset: 0, duration: 0.06, type: "triangle", gain: 0.6 },
    { freq: 1100, startOffset: 0.04, duration: 0.05, type: "triangle", gain: 0.5 },
    { freq: 1300, startOffset: 0.08, duration: 0.05, type: "triangle", gain: 0.4 },
  ], 0.15);
}
function webExchange(): void {
  playWebNotes([
    { freq: 528, startOffset: 0, duration: 0.12, type: "sine", gain: 0.8 },
    { freq: 660, startOffset: 0.08, duration: 0.12, type: "sine", gain: 0.7 },
    { freq: 792, startOffset: 0.16, duration: 0.18, type: "sine", gain: 0.6 },
  ]);
}

// ─── Native sounds (expo-av) ──────────────────────────────────────────────────

let soundCache: Record<string, Audio.Sound> = {};
let _audioModeSet = false;

async function ensureAudioMode(): Promise<void> {
  if (_audioModeSet) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    _audioModeSet = true;
  } catch {}
}

async function loadSound(key: string, assetModule: number): Promise<Audio.Sound | null> {
  if (soundCache[key]) return soundCache[key];
  try {
    await ensureAudioMode();
    const { sound } = await Audio.Sound.createAsync(assetModule, {
      shouldPlay: false,
      volume: 1.0,
    });
    soundCache[key] = sound;
    return sound;
  } catch {
    return null;
  }
}

async function playNative(key: string, assetModule: number, volume = 1.0): Promise<void> {
  try {
    await ensureAudioMode();
    const sound = await loadSound(key, assetModule);
    if (!sound) return;
    await sound.setVolumeAsync(volume);
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function playCardSelect(): Promise<void> {
  if (Platform.OS === "web") { webCardSelect(); return; }
  await playNative("select", require("../assets/sounds/card_select.mp3"), 0.75);
}

export async function playCardPlay(): Promise<void> {
  if (Platform.OS === "web") { webCardPlay(); return; }
  await playNative("play", require("../assets/sounds/card_play.mp3"), 1.0);
}

export async function playCardPass(): Promise<void> {
  if (Platform.OS === "web") { webCardPass(); return; }
  await playNative("pass", require("../assets/sounds/card_pass.mp3"), 0.75);
}

export async function playYourTurn(): Promise<void> {
  if (Platform.OS === "web") { webYourTurn(); return; }
  await playNative("your_turn", require("../assets/sounds/your_turn.mp3"), 0.9);
}

export async function playRoundStart(): Promise<void> {
  if (Platform.OS === "web") { webRoundStart(); return; }
  await playNative("round_start", require("../assets/sounds/round_start.mp3"), 0.85);
}

export async function playRoundWin(): Promise<void> {
  if (Platform.OS === "web") { webRoundWin(); return; }
  await playNative("round_win", require("../assets/sounds/round_win.mp3"), 1.0);
}

export async function playUrgentTick(): Promise<void> {
  if (Platform.OS === "web") { webUrgentTick(); return; }
  await playNative("urgent", require("../assets/sounds/urgent_tick.mp3"), 0.8);
}

export async function playBomb(): Promise<void> {
  if (Platform.OS === "web") { webBomb(); return; }
  await playNative("bomb", require("../assets/sounds/bomb.mp3"), 1.0);
}

export async function playGameWin(): Promise<void> {
  if (Platform.OS === "web") { webGameWin(); return; }
  await playNative("game_win", require("../assets/sounds/game_win.mp3"), 1.0);
}

export async function playGameLose(): Promise<void> {
  if (Platform.OS === "web") { webGameLose(); return; }
  await playNative("game_lose", require("../assets/sounds/game_lose.mp3"), 0.85);
}

export async function playDeal(): Promise<void> {
  if (Platform.OS === "web") { webDeal(); return; }
  await playNative("deal", require("../assets/sounds/deal.mp3"), 0.8);
}

export async function playExchange(): Promise<void> {
  if (Platform.OS === "web") { webExchange(); return; }
  await playNative("exchange", require("../assets/sounds/exchange.mp3"), 0.85);
}

export async function preloadSounds(): Promise<void> {
  if (Platform.OS === "web") {
    getWebCtx();
    return;
  }
  try {
    await ensureAudioMode();
    await Promise.all([
      loadSound("select", require("../assets/sounds/card_select.mp3")),
      loadSound("play", require("../assets/sounds/card_play.mp3")),
      loadSound("pass", require("../assets/sounds/card_pass.mp3")),
      loadSound("your_turn", require("../assets/sounds/your_turn.mp3")),
      loadSound("round_start", require("../assets/sounds/round_start.mp3")),
      loadSound("round_win", require("../assets/sounds/round_win.mp3")),
      loadSound("urgent", require("../assets/sounds/urgent_tick.mp3")),
      loadSound("bomb", require("../assets/sounds/bomb.mp3")),
      loadSound("game_win", require("../assets/sounds/game_win.mp3")),
      loadSound("game_lose", require("../assets/sounds/game_lose.mp3")),
      loadSound("deal", require("../assets/sounds/deal.mp3")),
      loadSound("exchange", require("../assets/sounds/exchange.mp3")),
    ]);
  } catch {}
}

export function unloadSounds(): void {
  Object.values(soundCache).forEach((s) => s.unloadAsync().catch(() => {}));
  soundCache = {};
}
