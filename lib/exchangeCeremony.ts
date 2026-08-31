// How long the exchange holds the table. Imported by the client, which draws
// the ceremony, and by the server, which decides when the next seat may move —
// so this file keeps to relative imports and away from `react-native`, because
// `server:build` bundles it with no alias resolution.
import { Reading } from "./tokens.ts";

/** How long each leg of a traded card's trip takes. */
export const EXCHANGE_LEG_MS = 460;
/** …and how long the two cards sit side by side at the middle. */
export const MEET_HOLD_MS = 260;
export const EXCHANGE_FLIGHT_MS = EXCHANGE_LEG_MS * 2 + MEET_HOLD_MS;

/**
 * The flight, and then long enough to read the tag each card leaves beside its
 * new owner. One answer to three questions — how long the announcement stays
 * up, how long a local turn waits, and how long the server holds a bot back —
 * so the table and the animation cannot drift apart.
 */
export function exchangeAnnounceMs(bothJokersException: boolean): number {
  return (bothJokersException ? 0 : EXCHANGE_FLIGHT_MS) + Reading.notice;
}
