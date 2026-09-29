// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import type { Combination } from "../../lib/game/gameEngine.ts";
import type { FlightSpec } from "./useFlightClock.ts";

export interface TrickPlay { key: string; combo: Combination; playedBy: number; spec: FlightSpec }
export interface Trick { plays: readonly TrickPlay[]; swept: { plays: readonly TrickPlay[]; to: { dx: number; dy: number } } | null }

export const NO_TRICK: Trick = { plays: [], swept: null };

const ids = (plays: readonly TrickPlay[]) => new Set(plays.flatMap((p) => p.combo.cards.map((c) => c.id)));
const shares = (plays: readonly TrickPlay[], play: TrickPlay) => {
  const held = ids(plays);
  return play.combo.cards.some((c) => held.has(c.id));
};

/**
 * States can arrive out of order (a replay scrubbing back, a resync skipping the empty table), so a
 * play already lower in the trick rewinds to it, and one reusing a card on the felt (card ids repeat
 * every manche) starts a fresh felt.
 */
export function playOnto(trick: Trick, play: TrickPlay): Trick {
  const at = trick.plays.findIndex((p) => p.key === play.key);
  if (at >= 0) return at === trick.plays.length - 1 ? trick : { ...trick, plays: trick.plays.slice(0, at + 1) };
  const swept = trick.swept && shares(trick.swept.plays, play) ? null : trick.swept;
  if (shares(trick.plays, play)) return { plays: [play], swept };
  return { plays: [...trick.plays, play], swept };
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

const withRole = (plays: readonly TrickPlay[], role: PlayRole) => plays.find((_, i) => roleOf(plays, i) === role) ?? null;

export const topPlay = (plays: readonly TrickPlay[]) => withRole(plays, "top");
export const beatenPlay = (plays: readonly TrickPlay[]) => withRole(plays, "beaten");
