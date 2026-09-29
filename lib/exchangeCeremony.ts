// How long the exchange holds the table. Imported by the client, which draws
// the ceremony, and by the server, which decides when the next seat may move —
// so this file keeps to relative imports and away from `react-native`, because
// `server:build` bundles it with no alias resolution.
import { exchangeAnnounceFrom } from "./game/exchangeTimeline.ts";

/**
 * The give, and then long enough to read who traded what. One answer to three
 * questions — how long the announcement stays up, how long a local turn waits,
 * and how long the server holds a bot back — so the table and the animation
 * cannot drift apart.
 */
export function exchangeAnnounceMs(bothJokersException: boolean): number {
  return exchangeAnnounceFrom(bothJokersException);
}
