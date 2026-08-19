import type { Card } from "@/lib/gameEngine";

export interface ExchangeAnnounceData {
  winnerName: string;
  loserName: string;
  bothJokersException: boolean;
  cardGiven?: Card;
  cardReceived?: Card;
}
