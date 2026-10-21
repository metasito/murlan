export const BASE_PORT = 5199;
/** Enough for every run a machine can host at once; a wall this wide is a leak, not a queue. */
export const PORT_SPAN = 20;
/** Where `npm run play` serves, apart from the span an e2e run picks from. */
export const PLAY_PORT = 5000;
