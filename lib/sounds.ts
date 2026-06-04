import { Audio } from "expo-av";
import { Platform } from "react-native";

// ─── Web Audio API — plays the same MP3 assets as native via fetch + decode ───

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

// ─── Asset registry ───────────────────────────────────────────────────────────

// Each key maps to a function so Metro can statically analyse the require() calls.
const ASSETS = {
  select:      () => require("../assets/sounds/card_select.mp3") as number,
  play:        () => require("../assets/sounds/card_play.mp3") as number,
  pass:        () => require("../assets/sounds/card_pass.mp3") as number,
  your_turn:   () => require("../assets/sounds/your_turn.mp3") as number,
  round_start: () => require("../assets/sounds/round_start.mp3") as number,
  round_win:   () => require("../assets/sounds/round_win.mp3") as number,
  urgent:      () => require("../assets/sounds/urgent_tick.mp3") as number,
  bomb:        () => require("../assets/sounds/bomb.mp3") as number,
  game_win:    () => require("../assets/sounds/game_win.mp3") as number,
  game_lose:   () => require("../assets/sounds/game_lose.mp3") as number,
  deal:        () => require("../assets/sounds/deal.mp3") as number,
  exchange:    () => require("../assets/sounds/exchange.mp3") as number,
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
    await Promise.all(
      (Object.keys(ASSETS) as SoundKey[]).map((k) => loadSound(k, ASSETS[k]()))
    );
    soundsLoaded = true;
  } catch (err) {
    console.warn("[sounds] Preload failed (non-fatal):", err);
  } finally {
    soundsLoading = false;
  }
}

export function unloadSounds(): void {
  Object.values(soundCache).forEach((s) => s.unloadAsync().catch(() => {}));
  soundCache = {};
}
