/**
 * UI copy this suite reads as a signal rather than as a name.
 *
 * Naming a control by its visible text is what the suite does everywhere, on purpose — it
 * drives the app as a user sees it. These are different: they are compared for equality to
 * decide something, so the sentence is carrying a boolean, and a copy edit changes behaviour
 * rather than a selector.
 *
 * They live here so a copy edit fails `tests/e2eSentinels.test.ts` — once, saying it is a copy
 * edit — instead of failing several browser specs with what reads like a rules violation.
 *
 * The GIOCA button's state would be the better signal and is not available: it stays pressable
 * when the play is illegal so it can animate the rejection, so it carries no `disabled` prop,
 * and `a11yState`'s own `aria-disabled` does not survive to the DOM (#502).
 */

/** GIOCA's label when, and only when, the current selection is a legal play. */
export const GIOCA_VALID_LABEL = "Gioca le carte selezionate";
