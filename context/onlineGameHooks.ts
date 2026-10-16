/**
 * The online table's surface, in the six pieces a screen actually reads.
 *
 * `useOnlineGame()` hands back all thirty-eight fields, which makes every test
 * that touches any of them declare all of them: `connectingState.test.tsx`
 * wrote twenty-eight to assert a placeholder and a back button. These are
 * separate from the context module so a screen test can replace the slice it
 * reads without also replacing the provider.
 *
 * Each is a projection, never a home for logic — the provider still owns every
 * piece of state and every effect. What lives once and is shared with the
 * local game lives in `lib/game/sharedGameFlow.ts`.
 *
 * Each reads its own context, and that is where the render saving is: a field
 * change wakes only the screens reading the slice it belongs to. Each returns
 * the provider's memoized slice as it is, so its identity is the provider's
 * memo; a field belongs to a slice by its `Pick` in `OnlineGameContext.tsx`.
 */
import {
  useConnectionSlice,
  useExchangeSlice,
  useMatchSlice,
  useRoomSlice,
  useTableSlice,
  useTurnClockSlice,
} from "./OnlineGameContext";

/** Whether there is a live table at all, and the ways of being thrown off one. */
export function useOnlineConnection() {
  return useConnectionSlice();
}

/** Getting to a table, and leaving one. Nothing about playing at it. */
export function useOnlineRoom() {
  return useRoomSlice();
}

/** The hand in front of you and the two things you can do with it. */
export function useOnlineTable() {
  return useTableSlice();
}

/**
 * The acting seat's remaining AFK window. Online only — the local game has no
 * turn clock of any kind, and inventing one here so the two modes match would
 * be an abstraction telling a lie.
 */
export function useOnlineTurnClock() {
  return useTurnClockSlice();
}

/** Where the match stands, and whether the table wants another. */
export function useOnlineMatch() {
  return useMatchSlice();
}

/** The card that changes hands between rounds, and the banner about it. */
export function useOnlineExchange() {
  return useExchangeSlice();
}
