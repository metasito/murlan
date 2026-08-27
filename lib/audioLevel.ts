/**
 * Volume is the only audio switch: a level of 0 *is* muted, so there is no
 * separate on/off to disagree with it.
 *
 * `restore` is what unmuting comes back to. Without it, muting would throw the
 * chosen level away and unmuting after a restart would jump to full volume.
 */
export interface AudioLevel {
  volume: number;
  restore: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

const level = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v) : null;

export function withVolume(current: AudioLevel, v: number): AudioLevel {
  const volume = clamp(v);
  return { volume, restore: volume > 0 ? volume : current.restore };
}

export function withEnabled(current: AudioLevel, on: boolean, fallback: number): AudioLevel {
  if (!on) return { ...current, volume: 0 };
  return { ...current, volume: current.restore > 0 ? current.restore : fallback };
}

/**
 * Reads a level out of the stored settings object, whatever build wrote it.
 *
 * A build before #414 stored `enabled` alongside the volume, and nothing writes
 * that key any more — but dropping it here would silently un-mute every account
 * that had audio off.
 */
export function migrateLevel(
  stored: { enabled?: unknown; volume?: unknown; restore?: unknown },
  fallback: number
): AudioLevel {
  // `??`, never `||`: a stored volume of 0 is a muted player, and coalescing it
  // to the fallback would un-mute the whole install base on the second launch,
  // after the first write has dropped the `enabled` key that said so.
  const volume = level(stored.volume) ?? fallback;
  const audible = volume > 0 ? volume : fallback;
  if (stored.enabled === false) return { volume: 0, restore: audible };
  // A stored restore of 0 is no level to come back to, so it falls through.
  return { volume, restore: level(stored.restore) || audible };
}

export interface StoredAudio {
  soundVolume: number;
  soundVolumeRestore: number;
  musicVolume: number;
  musicVolumeRestore: number;
}

/**
 * Which stored key feeds which level. Here rather than inline in the provider
 * because a transposition — the music volume reaching the sound level, say —
 * type-checks, and would mis-migrate every account in silence.
 */
export function migrateAudio(
  v: Record<string, unknown>,
  soundFallback: number,
  musicFallback: number
): StoredAudio {
  const sound = migrateLevel(
    { enabled: v.soundsEnabled, volume: v.soundVolume, restore: v.soundVolumeRestore },
    soundFallback
  );
  const music = migrateLevel(
    { enabled: v.musicEnabled, volume: v.musicVolume, restore: v.musicVolumeRestore },
    musicFallback
  );
  return {
    soundVolume: sound.volume,
    soundVolumeRestore: sound.restore,
    musicVolume: music.volume,
    musicVolumeRestore: music.restore,
  };
}
