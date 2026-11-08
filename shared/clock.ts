// Read by the table's notice model, so anything imported here is imported into the app bundle.

/** The longest countdown a seat's clock may be given: its digits are what the turn chip reserves. */
export const CLOCK_CEILING_MS = 99_000;

/** How many digits a countdown from `ms` draws at its start. */
export const clockDigits = (ms: number): number => String(Math.ceil(ms / 1000)).length;
