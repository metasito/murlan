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
export const HAND_COUNT = /(\d+) cart[ae] in mano/g;

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

export const SUIT_WORDS = ["Fiori", "Cuori", "Quadri", "Picche"];

/** Every rank's spoken word, weakest first; a joker's word is its whole name. */
export const RANK_WORDS = [
  "3", "4", "5", "6", "7", "8", "9", "10",
  "Fante", "Donna", "Re", "Asso", "2",
  "Jolly nero", "Jolly rosso",
];
