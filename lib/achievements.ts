// Pure achievement catalogue and evaluation.
//
// Deliberately NOT an "achievements engine": no trigger registry, no event
// bus, no rule DSL. Each entry in `ACHIEVEMENTS` pairs an id with a plain
// `(result: GameResult) => boolean` predicate; `evaluateAchievements` just
// filters the array. That is the whole design — see
// docs/superpowers/specs/2026-08-16-murlan-depth-design.md §1, which calls
// out a general-purpose achievements framework as YAGNI.
//
// No React/React Native/expo-* imports here on purpose: this module must be
// importable by plain `node --test` (tests/achievements.test.ts) with no
// database and no app runtime. Only the `TranslationKey` *type* is pulled
// from lib/i18n.ts — `import type` erases at compile time, so it does not
// drag in that module's AsyncStorage/expo-localization dependencies.
//
// Task 8 (server/stats.ts) calls `evaluateAchievements` at game-over and
// persists the returned ids with `onConflictDoNothing`, so an id appearing
// here on every qualifying game (e.g. every win unlocks "first_win") is by
// design — idempotent persistence, not "first ever" tracking, is what makes
// it actually mean "first".
import type { TranslationKey } from "./i18n.ts";

/** One completed game's outcome for a single player, as recorded at game over. */
export interface GameResult {
  userId: string;
  /** 1 = won the hand, up to `playerCount`. */
  placement: number;
  playerCount: number;
  /** Did this player play a bomb (four of a kind) at any point in this hand? */
  playedBomb: boolean;
  /** Did this player play a joker (always as a single, per the rules) in this hand? */
  playedJoker: boolean;
  /** Did this player win the whole match (reached the 21/31/41/51 target), not just this hand? */
  matchWon: boolean;
  /**
   * How many opponents actually went out (emptied their hand) in this hand —
   * NOT `playerCount - 1`. Per docs/RULES.md §9 and lib/gameEngine.ts:687-690
   * ("The hand ends when only one player still holds cards; that player is
   * last"), the last-place player is auto-assigned their finish position
   * once they're the sole player left holding cards — they never empty
   * their hand. So this value tops out at `playerCount - 2`: every player
   * except the winner and the last-place finisher.
   */
  opponentsFinished: number;
}

export interface AchievementDef {
  id: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
}

/** An `AchievementDef` plus the predicate that decides whether a game result earns it. */
interface AchievementRule extends AchievementDef {
  isEarned: (result: GameResult) => boolean;
}

const RULES: readonly AchievementRule[] = [
  {
    id: "first_win",
    nameKey: "achievements.firstWin.name",
    descKey: "achievements.firstWin.desc",
    isEarned: (r) => r.placement === 1,
  },
  {
    id: "runner_up",
    nameKey: "achievements.runnerUp.name",
    descKey: "achievements.runnerUp.desc",
    isEarned: (r) => r.placement === 2,
  },
  {
    id: "bombardier",
    nameKey: "achievements.bombardier.name",
    descKey: "achievements.bombardier.desc",
    isEarned: (r) => r.placement === 1 && r.playedBomb,
  },
  {
    id: "purist",
    nameKey: "achievements.purist.name",
    descKey: "achievements.purist.desc",
    isEarned: (r) => r.placement === 1 && !r.playedJoker,
  },
  {
    id: "wild_card",
    nameKey: "achievements.wildCard.name",
    descKey: "achievements.wildCard.desc",
    isEarned: (r) => r.placement === 1 && r.playedBomb && r.playedJoker,
  },
  {
    id: "minimalist",
    nameKey: "achievements.minimalist.name",
    descKey: "achievements.minimalist.desc",
    isEarned: (r) => r.placement === 1 && !r.playedBomb && !r.playedJoker,
  },
  {
    id: "duelist",
    nameKey: "achievements.duelist.name",
    descKey: "achievements.duelist.desc",
    isEarned: (r) => r.placement === 1 && r.playerCount === 2,
  },
  {
    id: "full_table",
    nameKey: "achievements.fullTable.name",
    descKey: "achievements.fullTable.desc",
    // Every opponent who *could* go out did: the winner plus both non-last
    // opponents emptied their hands, and only the last-place player was left
    // holding cards (see the `opponentsFinished` doc comment above — its max
    // is `playerCount - 2`, never `playerCount - 1`).
    isEarned: (r) => r.placement === 1 && r.playerCount === 4 && r.opponentsFinished === r.playerCount - 2,
  },
  {
    id: "match_champion",
    nameKey: "achievements.matchChampion.name",
    descKey: "achievements.matchChampion.desc",
    isEarned: (r) => r.matchWon,
  },
  {
    id: "iron_will",
    nameKey: "achievements.ironWill.name",
    descKey: "achievements.ironWill.desc",
    isEarned: (r) => r.matchWon && !r.playedJoker,
  },
];

/** The full catalogue, for display (e.g. a locked/earned achievements list). */
export const ACHIEVEMENTS: readonly AchievementDef[] = RULES;

/** Returns the ids of every achievement `result` qualifies for. */
export function evaluateAchievements(result: GameResult): string[] {
  return RULES.filter((rule) => rule.isEarned(result)).map((rule) => rule.id);
}
