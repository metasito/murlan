/**
 * The online table's surface, in the six pieces a screen actually reads.
 *
 * `useOnlineGame()` hands back all thirty-seven fields, which makes every test
 * that touches any of them declare all of them: `connectingState.test.tsx`
 * wrote twenty-eight to assert a placeholder and a back button. These are
 * separate from the context module so a screen test can replace the slice it
 * reads without also replacing the provider.
 *
 * Each is a projection, never a home for logic — the provider still owns every
 * piece of state and every effect. What lives once and is shared with the
 * local game lives in `lib/sharedGameFlow.ts`.
 *
 * Each reads its own context, and that is where the render saving is: a field
 * change wakes only the screens reading the slice it belongs to. The `useMemo`
 * around each result is a second, cheaper guarantee — the first call site to
 * keep the object rather than unpack it, a dependency array or a memoized
 * child, would otherwise get a new one every render, and that failure looks
 * like an unrelated render loop. `exhaustive-deps` is an error in this repo,
 * so the lists cannot drift out of step with the destructures above them.
 */
import { useMemo } from "react";
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
  const {
    connected,
    error,
    reconnectNotice,
    playerLeft,
    rejoinFailed,
    clearError,
    clearPlayerLeft,
    clearRejoinFailed,
  } = useConnectionSlice();
  return useMemo(
    () => ({
      connected,
      error,
      reconnectNotice,
      playerLeft,
      rejoinFailed,
      clearError,
      clearPlayerLeft,
      clearRejoinFailed,
    }),
    [
      connected,
      error,
      reconnectNotice,
      playerLeft,
      rejoinFailed,
      clearError,
      clearPlayerLeft,
      clearRejoinFailed,
    ]
  );
}

/** Getting to a table, and leaving one. Nothing about playing at it. */
export function useOnlineRoom() {
  const {
    room,
    entrySource,
    isSpectator,
    createRoom,
    joinRoom,
    spectateRoom,
    leaveRoom,
    quickmatch,
    startGame,
  } = useRoomSlice();
  return useMemo(
    () => ({
      room,
      entrySource,
      isSpectator,
      createRoom,
      joinRoom,
      spectateRoom,
      leaveRoom,
      quickmatch,
      startGame,
    }),
    [
      room,
      entrySource,
      isSpectator,
      createRoom,
      joinRoom,
      spectateRoom,
      leaveRoom,
      quickmatch,
      startGame,
    ]
  );
}

/** The hand in front of you and the two things you can do with it. */
export function useOnlineTable() {
  const { gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats } =
    useTableSlice();
  return useMemo(
    () => ({ gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats }),
    [gameState, mySeatIndex, playCards, pass, sendReaction, disconnectedSeats]
  );
}

/**
 * The acting seat's remaining AFK window. Online only — the local game has no
 * turn clock of any kind, and inventing one here so the two modes match would
 * be an abstraction telling a lie.
 */
export function useOnlineTurnClock() {
  const { turnSeconds, turnDeadlineMs } = useTurnClockSlice();
  return useMemo(() => ({ turnSeconds, turnDeadlineMs }), [turnSeconds, turnDeadlineMs]);
}

/** Where the match stands, and whether the table wants another. */
export function useOnlineMatch() {
  const {
    matchState,
    cumulativeScores,
    handScores,
    ratingDeltas,
    handRecorded,
    rematchVoteState,
    endMatchVoteState,
    rematchIntents,
    rematchPromptOpen,
    voteRematch,
    voteToEndMatch,
    answerRematch,
  } = useMatchSlice();
  return useMemo(
    () => ({
      matchState,
      cumulativeScores,
      handScores,
      ratingDeltas,
      handRecorded,
      rematchVoteState,
      endMatchVoteState,
      rematchIntents,
      rematchPromptOpen,
      voteRematch,
      voteToEndMatch,
      answerRematch,
    }),
    [
      matchState,
      cumulativeScores,
      handScores,
      ratingDeltas,
      handRecorded,
      rematchVoteState,
      endMatchVoteState,
      rematchIntents,
      rematchPromptOpen,
      voteRematch,
      voteToEndMatch,
      answerRematch,
    ]
  );
}

/** The card that changes hands between manches, and the banner about it. */
export function useOnlineExchange() {
  const { exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange } =
    useExchangeSlice();
  return useMemo(
    () => ({ exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange }),
    [exchangeAnnouncing, exchangeAnnounceData, giveExchangeCard, acknowledgeExchange]
  );
}
