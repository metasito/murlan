import { CHANNELS } from "../../../lib/harnessChannels.ts";

/**
 * How this suite finds the game table and the viewer's hand.
 *
 * Both zones publish their state sentence as a `data-*` attribute rather than an
 * `aria-label`: neither container is `accessible`, so a name there would reach no
 * reader, and matching on the attribute's *name* keeps the Italian sentence out of
 * the selector — a translation edit used to break these and report it as a game bug.
 */
export const TABLE = '[data-testid="game-table"]';
/** The whole table screen: the felt's parent also holds the top bar and the HUD, which `TABLE` does not. */
export const TABLE_SCREEN = ':has(> [data-testid="table-felt"])';

/** The table's own screen-reader sentence (`describeTableForA11y`). */
export const TABLE_STATE = CHANNELS.tableState;
/** "true" from the table's entry until the last dealt card lands. */
export const TABLE_DEALING = CHANNELS.dealing;
export const HAND_ZONE = `[${CHANNELS.handState}]`;
/** The drawn card inside each hand slot, not its pressable strip. */
export const HAND_CARD_BOXES = `${HAND_ZONE} [data-testid="card-box"]`;
export const HAND_SELECTED = `${HAND_ZONE} [aria-pressed="true"]`;
/** "true" on a seat ring while its seat holds the turn. */
export const SEAT_LIT = CHANNELS.seatLit;

/**
 * Scoped to the hand wrapper, not anywhere under the table: the played pile renders
 * real, correctly-labelled CardView buttons too, and an unscoped `[role="button"]`
 * sweep picks those up as if they were playable hand cards.
 */
export const HAND_CARDS = `${TABLE} ${HAND_ZONE} [role="button"]`;
