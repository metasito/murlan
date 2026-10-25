// The server imports this: relative `.ts` imports only (tests/tooling/libGameBoundary.test.ts).
import type { Gate } from "../game/turnSchedule.ts";
import { Hold, Motion, Reading } from "../tokens.ts";
import { dealEndMs } from "./dealTimeline.ts";
import { exchangeAnnounceMs, exchangeGiveDelayMs } from "./exchangeTimeline.ts";

export const OPENING_NOTICE_MS = Reading.notice;

/** From the moment the turn is armed until every gate has passed; each gate starts where the one before it ends. */
export function gateMs(gates: readonly Gate[], counts: readonly number[], twoJokers: boolean): number {
  const dealt = dealEndMs(counts, Motion.duration.reveal);
  const span: Record<Gate, number> = {
    deal: dealt,
    receive: exchangeGiveDelayMs(counts) - dealt,
    ceremony: exchangeAnnounceMs(twoJokers),
    // The whole ceremony: the receive, its reading, and a beat for the pills to say there is nothing to give back.
    oneWay: exchangeGiveDelayMs(counts) - dealt + Hold.reveal,
    opening: OPENING_NOTICE_MS,
  };
  return gates.reduce((ms, gate) => ms + span[gate], 0);
}
