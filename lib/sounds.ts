import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Platform } from "react-native";

// Effects are CC0 recordings, built by scripts/build-sounds.mjs and shipped as
// 44.1 kHz mono 16-bit WAV. WAV rather than the sources' OGG because iOS will
// not play OGG. Web decodes the same assets through the Web Audio API.

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

const webAudioCache: Record<string, AudioBuffer> = {};

async function preloadWebAsset(key: string, assetModule: number): Promise<void> {
  const ctx = getWebCtx();
  if (!ctx || webAudioCache[key]) return;
  try {
    const url = assetModule as unknown as string;
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    webAudioCache[key] = await ctx.decodeAudioData(arrayBuf);
  } catch {}
}

async function playWeb(key: string, assetModule: number, volume: number): Promise<void> {
  const ctx = getWebCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (!webAudioCache[key]) await preloadWebAsset(key, assetModule);
    const buffer = webAudioCache[key];
    if (!buffer) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch {}
}


let soundCache: Record<string, AudioPlayer> = {};
let _audioModeSet = false;

async function ensureAudioMode(): Promise<void> {
  if (_audioModeSet) return;
  try {
    await setAudioModeAsync({
      // Card games are routinely played with the ringer off.
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionModeAndroid: "duckOthers",
    });
    _audioModeSet = true;
  } catch {}
}

function loadSound(key: string, assetModule: number): AudioPlayer | null {
  const cached = soundCache[key];
  if (cached) return cached;
  try {
    const player = createAudioPlayer(assetModule);
    soundCache[key] = player;
    return player;
  } catch {
    return null;
  }
}

async function playNative(key: string, assetModule: number, volume = 1.0): Promise<void> {
  try {
    await ensureAudioMode();
    const player = loadSound(key, assetModule);
    if (!player) return;
    player.volume = volume;
    // A player parked at the end of its buffer plays silence, so rewind first.
    player.seekTo(0);
    player.play();
  } catch {}
}

// ─── Asset registry ───────────────────────────────────────────────────────────

// Each key maps to a function so Metro can statically analyse the require() calls.
const ASSETS = {
  select:      () => require("../assets/sounds/card_select.wav") as number,
  play:        () => require("../assets/sounds/card_play.wav") as number,
  pass:        () => require("../assets/sounds/card_pass.wav") as number,
  your_turn:   () => require("../assets/sounds/your_turn.wav") as number,
  round_start: () => require("../assets/sounds/round_start.wav") as number,
  round_win:   () => require("../assets/sounds/round_win.wav") as number,
  urgent:      () => require("../assets/sounds/urgent_tick.wav") as number,
  bomb:        () => require("../assets/sounds/bomb.wav") as number,
  game_win:    () => require("../assets/sounds/game_win.wav") as number,
  game_lose:   () => require("../assets/sounds/game_lose.wav") as number,
  deal:        () => require("../assets/sounds/deal.wav") as number,
  exchange:    () => require("../assets/sounds/exchange.wav") as number,
} as const;

type SoundKey = keyof typeof ASSETS;

// ─── Master enable/disable ────────────────────────────────────────────────────

let _soundsEnabled = true;
export function setSoundsMasterEnabled(v: boolean) { _soundsEnabled = v; }

// ─── Unified play ─────────────────────────────────────────────────────────────

async function play(key: SoundKey, volume: number): Promise<void> {
  if (!_soundsEnabled) return;
  const asset = ASSETS[key]();
  if (Platform.OS === "web") {
    await playWeb(key, asset, volume);
  } else {
    await playNative(key, asset, volume);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function playCardSelect(): Promise<void> { await play("select",      0.75); }
export async function playCardPlay():   Promise<void> { await play("play",        1.0);  }
export async function playCardPass():   Promise<void> { await play("pass",        0.75); }
export async function playYourTurn():   Promise<void> { await play("your_turn",   0.9);  }
export async function playRoundStart(): Promise<void> { await play("round_start", 0.85); }
export async function playRoundWin():   Promise<void> { await play("round_win",   1.0);  }
export async function playUrgentTick(): Promise<void> { await play("urgent",      0.8);  }
export async function playBomb():       Promise<void> { await play("bomb",        1.0);  }
export async function playGameWin():    Promise<void> { await play("game_win",    1.0);  }
export async function playGameLose():   Promise<void> { await play("game_lose",   0.85); }
export async function playDeal():       Promise<void> { await play("deal",        0.8);  }
export async function playExchange():   Promise<void> { await play("exchange",    0.85); }

// ─── Preload ──────────────────────────────────────────────────────────────────

let soundsLoaded = false;
let soundsLoading = false;

export async function preloadSounds(): Promise<void> {
  if (soundsLoaded || soundsLoading) return;
  soundsLoading = true;
  if (Platform.OS === "web") {
    getWebCtx();
    try {
      await Promise.all(
        (Object.keys(ASSETS) as SoundKey[]).map((k) =>
          preloadWebAsset(k, ASSETS[k]())
        )
      );
    } catch {}
    soundsLoaded = true;
    soundsLoading = false;
    return;
  }
  try {
    await ensureAudioMode();
    (Object.keys(ASSETS) as SoundKey[]).forEach((k) => loadSound(k, ASSETS[k]()));
    soundsLoaded = true;
  } catch (err) {
    console.warn("[sounds] Preload failed (non-fatal):", err);
  } finally {
    soundsLoading = false;
  }
}

export function unloadSounds(): void {
  Object.values(soundCache).forEach((p) => {
    try {
      p.remove();
    } catch {}
  });
  soundCache = {};
  soundsLoaded = false;
}
