// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination } from "../../lib/game/gameEngine.ts";
import type { FlightSpec } from "./useFlightClock.ts";

export interface TrickPlay { key: string; combo: Combination; playedBy: number; spec: FlightSpec }
export interface Trick { plays: readonly TrickPlay[]; swept: { plays: readonly TrickPlay[]; to: { dx: number; dy: number } } | null }

export const NO_TRICK: Trick = { plays: [], swept: null };

export function playOnto(trick: Trick, play: TrickPlay): Trick {
  if (trick.plays.some((p) => p.key === play.key)) return trick;
  return { ...trick, plays: [...trick.plays, play] };
}

export function sweepTrick(trick: Trick, to: { dx: number; dy: number }): Trick {
  return { plays: [], swept: { plays: trick.plays, to } };
}

export function clearTrick(trick: Trick): Trick {
  return trick.plays.length === 0 ? trick : { ...trick, plays: [] };
}

export function sweepEnded(trick: Trick): Trick {
  return trick.swept === null ? trick : { ...trick, swept: null };
}

export type PlayRole = "top" | "beaten" | "buried";

export function roleOf(plays: readonly TrickPlay[], i: number): PlayRole {
  const fromTop = plays.length - 1 - i;
  return fromTop === 0 ? "top" : fromTop === 1 ? "beaten" : "buried";
}

export function topPlay(trick: Pick<Trick, "plays">): TrickPlay | null {
  return trick.plays.at(-1) ?? null;
}

export function beatenPlay(trick: Pick<Trick, "plays">): TrickPlay | null {
  return trick.plays.at(-2) ?? null;
}
