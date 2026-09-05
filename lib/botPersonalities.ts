// Named AI opponents. A personality is a preset over the engine's existing
// strategy tier plus two knobs that re-rank an already-legal candidate list —
// it never changes what is legal, which stays entirely in getAllValidPlays.
//
// Pure: no react-native import, so `node --test` can load it directly.
import type { AIDifficulty } from "./gameEngine.ts";
import type { TranslationKey } from "./i18n.ts";

export type BotPersonalityId = "luan" | "besnik" | "gent";

export interface BotPersonality {
  id: BotPersonalityId;
  /** A person's name, deliberately not translated — it reads the same in every locale. */
  name: string;
  /** Which of the engine's strategy tiers this personality plays on. */
  difficulty: AIDifficulty;
  /** 0–1. How readily it spends a 2, a joker or a bomb, and how rarely it passes. */
  aggression: number;
  /** 0–1. How often it takes a same-shape play that is legal but not the best one. */
  unpredictability: number;
}

/**
 * Exactly three, one per AIDifficulty tier (#904) — a difficulty ladder needs
 * a worse policy at each step, which lib/gameEngine.ts's tiers already are
 * (only "hard" counts cards, protects 2s/jokers, and branches in the
 * endgame), not the same policy with aggression/unpredictability turned down.
 */
export const BOT_PERSONALITIES: readonly BotPersonality[] = [
  { id: "luan", name: "Luan", difficulty: "easy", aggression: 0.5, unpredictability: 0.45 },
  { id: "besnik", name: "Besnik", difficulty: "medium", aggression: 0.8, unpredictability: 0.2 },
  { id: "gent", name: "Gent", difficulty: "hard", aggression: 0.85, unpredictability: 0.05 },
] as const;

export const DEFAULT_BOT_PERSONALITY: BotPersonalityId = "besnik";

const BY_ID = new Map<string, BotPersonality>(BOT_PERSONALITIES.map((p) => [p.id, p]));

export function isBotPersonalityId(value: unknown): value is BotPersonalityId {
  return typeof value === "string" && BY_ID.has(value);
}

/** Always resolves: an unknown or absent id falls back to the default personality. */
export function getBotPersonality(id: string | undefined): BotPersonality {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_BOT_PERSONALITY)!;
}

/** The one-line play-style description shown next to the name when picking. */
export function botBlurbKey(id: BotPersonalityId): TranslationKey {
  return `bot.${id}Blurb` as TranslationKey;
}

/**
 * Display names for a set of bot seats. Two seats on the same personality would
 * otherwise be two players called "Luan"; only the repeated ones get numbered.
 */
export function botSeatNames(ids: BotPersonalityId[]): string[] {
  const totals = new Map<BotPersonalityId, number>();
  for (const id of ids) totals.set(id, (totals.get(id) ?? 0) + 1);

  const used = new Map<BotPersonalityId, number>();
  return ids.map((id) => {
    const name = getBotPersonality(id).name;
    if ((totals.get(id) ?? 0) === 1) return name;
    const n = (used.get(id) ?? 0) + 1;
    used.set(id, n);
    return `${name} ${n}`;
  });
}
