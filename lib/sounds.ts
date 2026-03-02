import { Audio } from "expo-av";
import { Platform } from "react-native";

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

async function playSound(key: string, assetModule: number, volume = 1.0): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const sound = await loadSound(key, assetModule);
    if (!sound) return;
    await sound.setVolumeAsync(volume);
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
  }
}

export async function playCardSelect(): Promise<void> {
  await playSound("select", require("../assets/sounds/card_select.mp3"), 0.35);
}

export async function playCardPlay(): Promise<void> {
  await playSound("play", require("../assets/sounds/card_play.mp3"), 0.9);
}

export async function playCardPass(): Promise<void> {
  await playSound("pass", require("../assets/sounds/card_pass.mp3"), 0.5);
}

export async function preloadSounds(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    await Promise.all([
      loadSound("select", require("../assets/sounds/card_select.mp3")),
      loadSound("play", require("../assets/sounds/card_play.mp3")),
      loadSound("pass", require("../assets/sounds/card_pass.mp3")),
    ]);
  } catch {
  }
}

export function unloadSounds(): void {
  Object.values(soundCache).forEach((s) => s.unloadAsync().catch(() => {}));
  soundCache = {};
}
