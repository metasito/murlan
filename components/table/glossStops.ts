// The gradients the fan's gloss paints, from the card-gloss tokens: the spot's is the one `scripts/bake-card-art.mjs`
// bakes into its art. Apart from `cardGloss.ts` so that the first load, which never draws them, does not carry them.
//
// JSX-free, runtime imports relative — docs/agents/checks.md, "Node's TypeScript loader".

import { CardGloss } from "../../lib/tokens.ts";

/** The spot's radial gradient at full alpha (the overlay's opacity carries `spot.alpha` times the level): `scripts/bake-card-art.mjs` bakes the same stops into the spot's art. */
export const SPOT_STOPS = [
  { at: 0, color: CardGloss.spot.color, alpha: 1 },
  { at: CardGloss.spot.mid.at, color: CardGloss.spot.mid.color, alpha: CardGloss.spot.mid.alpha / CardGloss.spot.alpha },
  { at: 1, color: CardGloss.spot.mid.color, alpha: 0 },
] as const;

/** The streak's gradient across its band, at full alpha. */
export const STREAK_STOPS = [
  { at: 0, color: CardGloss.streak.color, alpha: 0 },
  { at: 0.5, color: CardGloss.streak.color, alpha: 1 },
  { at: 1, color: CardGloss.streak.color, alpha: 0 },
] as const;
