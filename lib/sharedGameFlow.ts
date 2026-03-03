import type { Card } from "@/lib/gameEngine";

export const EXCHANGE_ANNOUNCE_DURATION_MS = 3500;
export const BOTH_JOKERS_DISMISS_DURATION_MS = 3000;

export interface ExchangeAnnounceData {
  winnerName: string;
  loserName: string;
  bothJokersException: boolean;
  cardGiven?: Card;
  cardReceived?: Card;
}
