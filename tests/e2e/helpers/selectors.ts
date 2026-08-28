/**
 * How this suite finds the game table and the viewer's hand.
 *
 * Both zones publish their state sentence as a `data-*` attribute rather than an
 * `aria-label`: neither container is `accessible`, so a name there would reach no
 * reader, and matching on the attribute's *name* keeps the Italian sentence out of
 * the selector — a translation edit used to break these and report it as a game bug.
 */
export const TABLE = '[data-testid="game-table"]';

/** The table's own screen-reader sentence (`describeTableForA11y`). */
export const TABLE_STATE = "data-table-state";
export const HAND_ZONE = "[data-hand-state]";

/**
 * Scoped to the hand wrapper, not anywhere under the table: the played pile renders
 * real, correctly-labelled CardView buttons too, and an unscoped `[role="button"]`
 * sweep picks those up as if they were playable hand cards.
 */
export const HAND_CARDS = `${TABLE} ${HAND_ZONE} [role="button"]`;
