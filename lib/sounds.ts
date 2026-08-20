import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Platform } from "react-native";

// Effects are CC0 recordings, built by scripts/build-sounds.mjs and shipped as
// 44.1 kHz mono MP3. MP3 rather than the sources' OGG because iOS will not
// play OGG; MP3 decodes natively on iOS, Android and every browser, so no
// per-platform format branch is needed. Web decodes the same assets through
// the Web Audio API.

let _webCtx: AudioContext | null = null;
let _unlockBound = false;

/** Fetched bytes, which need no context, and decoded buffers, which do. */
const webRawCache: Record<string, ArrayBuffer> = {};
const webAudioCache: Record<string, AudioBuffer> = {};

/** The context if a gesture has already built one. Never constructs one. */
function peekWebCtx(): AudioContext | null {
  return Platform.OS === "web" ? _webCtx : null;
}

function buildWebCtx(): AudioContext | null {
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

/**
 * Chrome and Safari park a context built outside a user gesture in `suspended`,
 * and Safari only honours `resume()` when it is called synchronously inside the
 * gesture — before any await. So the context is built here, in the handler, and
 * nowhere else.
 *
 * The listeners stay bound rather than firing once: Safari's `interrupted`
 * state is distinct from `suspended` and can arrive at any time — a phone call,
 * another app taking the audio session — and the next tap is what recovers it.
 */
function unlockWebAudio(): void {
  // iOS silences Web Audio with the ringer switch, because the session
  // defaults to "ambient" — the same reason the native path asks for
  // playsInSilentMode. Since iOS 17 the category can simply be requested
  // (WebKit 237322), so web and native now ask for the same thing. Safari-only
  // so far, hence the check.
  if (typeof navigator !== "undefined") {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  }

  const ctx = buildWebCtx();
  if (!ctx) return;
  if (ctx.state !== "running") void ctx.resume();
  void decodeWebAssets(ctx);
}

export function bindWebAudioUnlock(): void {
  if (Platform.OS !== "web" || _unlockBound) return;
  if (typeof document === "undefined") return;
  _unlockBound = true;
  for (const event of ["pointerdown", "touchend", "keydown"]) {
    document.addEventListener(event, unlockWebAudio, { passive: true });
  }
}

async function fetchWebAsset(key: string, assetModule: number): Promise<void> {
  if (webRawCache[key] || webAudioCache[key]) return;
  try {
    const url = assetModule as unknown as string;
    const resp = await fetch(url);
    webRawCache[key] = await resp.arrayBuffer();
  } catch {}
}

async function decodeWebAsset(key: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  if (webAudioCache[key]) return webAudioCache[key];
  const raw = webRawCache[key];
  if (!raw) return null;
  try {
    // decodeAudioData detaches the buffer it is given, so a retry would decode
    // zero bytes. The copy is what keeps the fetch reusable.
    webAudioCache[key] = await ctx.decodeAudioData(raw.slice(0));
    return webAudioCache[key];
  } catch {
    return null;
  }
}

async function decodeWebAssets(ctx: AudioContext): Promise<void> {
  try {
    await Promise.all(Object.keys(webRawCache).map((k) => decodeWebAsset(k, ctx)));
  } catch {}
}

async function playWeb(key: string, assetModule: number, volume: number): Promise<void> {
  const ctx = peekWebCtx();
  // No gesture yet, so there is nothing a browser would let us sound anyway.
  if (!ctx) return;
  try {
    if (ctx.state !== "running") void ctx.resume();
    let buffer: AudioBuffer | undefined = webAudioCache[key];
    if (!buffer) {
      await fetchWebAsset(key, assetModule);
      buffer = (await decodeWebAsset(key, ctx)) ?? undefined;
    }
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

// ─── Master enable/volume ─────────────────────────────────────────────────────
//
// The per-effect volumes below are a mix, balancing the effects against each
// other. The master multiplies that mix rather than replacing it, so turning the
// game down keeps a card select quieter than a bomb.

let _soundsEnabled = true;
export function setSoundsMasterEnabled(v: boolean) { _soundsEnabled = v; }

let _masterVolume = 1;
export function setSoundsMasterVolume(v: number) {
  _masterVolume = Math.max(0, Math.min(1, v));
}

// ─── Unified play ─────────────────────────────────────────────────────────────

async function play(key: SoundKey, volume: number): Promise<void> {
  if (!_soundsEnabled || _masterVolume === 0) return;
  const level = volume * _masterVolume;
  const asset = ASSETS[key]();
  if (Platform.OS === "web") {
    await playWeb(key, asset, level);
  } else {
    await playNative(key, asset, level);
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
    // Fetching needs no context, so it stays on mount; only building the
    // context and resuming it are gesture-bound.
    try {
      await Promise.all(
        (Object.keys(ASSETS) as SoundKey[]).map((k) => fetchWebAsset(k, ASSETS[k]()))
      );
    } catch {}
    const ctx = peekWebCtx();
    if (ctx) await decodeWebAssets(ctx);
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
