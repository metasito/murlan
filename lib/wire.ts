// The HTTP shapes as JSON delivers them — not shared/schema.ts's row types,
// because a `Date` column arrives here as an ISO string.
import type { GameMode } from "./gameEngine";

export interface UserStatsDto {
  userId: string;
  gamesPlayed: number;
  gamesWon: number;
  matchesWon: number;
  currentStreak: number;
  bestStreak: number;
  dailyStreak: number;
  bombsPlayed: number;
  updatedAt: string;
}

export interface RatingDto {
  season: string;
  rating: number;
  games: number;
  provisional: boolean;
}

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  username: string;
  rating: number;
  games: number;
}

export interface AchievementStatusDto {
  id: string;
  nameKey: string;
  descKey: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface FriendInfo {
  id: string;
  username: string;
  lastSeen: string | null;
}

export interface HistoryParticipantDto {
  name: string | null;
  bot: boolean;
}

export interface MatchHistoryDto {
  id: string;
  userId: string;
  finishedAt: string;
  gameMode: GameMode;
  placement: number;
  playerCount: number;
  points: number;
  opponents: unknown[];
  participants: HistoryParticipantDto[];
  replayId: string | null;
  /** Null for a hand the ladder did not rate — never 0, which is a rated hand that moved nobody. */
  ratingDelta: number | null;
}
