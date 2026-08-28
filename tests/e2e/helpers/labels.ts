/**
 * UI copy this suite compares for equality, rather than uses to name a control. The sentence
 * carries a boolean, so it is a protocol and belongs in one place — `tests/e2eSentinels.test.ts`
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
