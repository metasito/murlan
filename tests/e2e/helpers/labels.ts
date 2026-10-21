import { cardSpokenName, rankSpokenName, suitSpokenName } from "../../../lib/cardNames.ts";
import { createDeck, getRankStrength, getValidGivebackCards, START_CARD, type Card, type Rank } from "../../../lib/game/gameEngine.ts";
import type { TFn } from "../../../lib/i18n";
import { it } from "../../../locales/it.ts";

/**
 * UI copy this suite compares for equality, rather than uses to name a control. The sentence
 * carries a boolean, so it is a protocol and belongs in one place — `tests/tooling/e2eSentinels.test.ts`
 * holds what is here against `locales/it.ts`.
 *
 * GIOCA's own state would be the better signal and is not available: it stays pressable when the
 * play is illegal, so it has no `disabled` prop, and `a11yState`'s `aria-disabled` never reaches
 * the DOM (#502).
 */

/** GIOCA's label when, and only when, the current selection is a legal play. */
export const GIOCA_VALID_LABEL = "Gioca le carte selezionate";

/** How the table's own state sentence opens when the viewer is on move. */
export const YOUR_TURN_PREFIX = "È il tuo turno.";

/** How the table's state sentence opens while the viewer owes the exchange a card. */
export const EXCHANGE_GIVE_PREFIX = "Fase di scambio: devi dare una carta a";

/** One hand's size in the state sentence; group 1 is the count. */
export const HAND_COUNT = /(\d+) cart[ae] in mano/;

/** Every hand size the state sentence names, in order. */
export function handCounts(desc: string): number[] {
  return [...desc.matchAll(new RegExp(HAND_COUNT.source, "g"))].map((m) => Number(m[1]));
}

/** Another player's play in the state sentence; group 1 is its label. The viewer's own reads "Hai giocato", which this misses. */
export const OTHERS_PLAY = /ha giocato (.+?)\./;

/** The reply size each shape of play demands; -1 is a straight, which only a bomb answers here. A single matches none. */
export const REPLY_SIZE: [RegExp, number][] = [
  [/ha giocato coppia di/, 2],
  [/ha giocato tris di/, 3],
  [/ha giocato bomba di/, 4],
  [/ha giocato scala( reale)? di \d+ carte/, -1],
];

/** A card's spoken name is `<rank><CARD_NAME_JOIN><suit>`. */
export const CARD_NAME_JOIN = " di ";

/** The locale this suite runs the app in, read through the app's own card names. */
const t = ((key: keyof typeof it, vars: Record<string, string> = {}) =>
  it[key].replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "")) as unknown as TFn;

/** A rank's spoken word; a joker's word is its whole name. */
const rankWord = (rank: Rank) =>
  rank.startsWith("joker") ? cardSpokenName({ id: rank, rank, suit: null, isJoker: true }, t) : rankSpokenName(rank, t);

/** Each rank once, weakest first, as the engine orders them. */
const ranksOf = (cards: Card[]) => [...new Set(cards.map((c) => c.rank))].sort((a, b) => getRankStrength(a) - getRankStrength(b));

/** Every rank's spoken word, weakest first. */
export const RANK_WORDS = ranksOf(createDeck()).map(rankWord);

/** The words of the ranks a winner may give back, read off the engine's own giveback choice. */
export const GIVEBACK_RANK_WORDS = ranksOf(getValidGivebackCards(createDeck())).map(rankWord);

export const SUIT_WORDS = [...new Set(createDeck().flatMap((c) => (c.suit ? [suitSpokenName(c.suit, t)] : [])))];

/** The card that opens a match whenever it is dealt, as the hand names it. */
export const START_CARD_LABEL = cardSpokenName(START_CARD, t);
