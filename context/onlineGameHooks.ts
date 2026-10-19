/**
 * The online table's surface, in the six pieces a screen actually reads, each
 * reading its own context (`sliceContext` in `OnlineGameContext.tsx`). The path
 * is separate from the provider's so a screen test can replace the slices it
 * reads without also replacing the provider.
 */
export {
  useOnlineConnection,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
  useOnlineMatch,
  useOnlineExchange,
  useServerError,
} from "./OnlineGameContext";
