/**
 * Volume is the only audio switch: a level of 0 *is* muted, so there is no
 * separate on/off to disagree with it.
 *
 * `restore` is what unmuting comes back to. Without it, muting would throw the
 * chosen level away and unmuting after a restart would jump to full volume —
 * the one thing a mute button must not do.
 *
 * Sound and music both use this; the only difference between them is the
 * fallback level, which each passes in.
 */
export interface AudioLevel {
  /** 0–1. Zero is muted. */
  volume: number;
  /** 0–1. The level to return to when unmuting. */
  restore: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

const level = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v) : null;

/** Setting a volume. Any audible level becomes the one to come back to. */
export function withVolume(current: AudioLevel, v: number): AudioLevel {
  const volume = clamp(v);
  return { volume, restore: volume > 0 ? volume : current.restore };
}

/** Muting keeps the level to come back to; unmuting returns to it. */
export function withEnabled(current: AudioLevel, on: boolean, fallback: number): AudioLevel {
  if (!on) return { ...current, volume: 0 };
  return { ...current, volume: current.restore > 0 ? current.restore : fallback };
}

/**
 * Reads a level out of the stored settings object, whatever build wrote it.
 *
 * A build before #414 stored `enabled` alongside the volume. Dropping it would
 * silently un-mute every account that had audio off, so a stored `false` is
 * carried across as a volume of 0 with the old volume kept as the level to
 * return to.
 */
export function migrateLevel(
  stored: { enabled?: unknown; volume?: unknown; restore?: unknown },
  fallback: number
): AudioLevel {
  const volume = level(stored.volume) ?? fallback;
  if (stored.enabled === false) {
    return { volume: 0, restore: volume > 0 ? volume : fallback };
  }
  const restore = level(stored.restore) ?? (volume > 0 ? volume : fallback);
  return { volume, restore };
}
