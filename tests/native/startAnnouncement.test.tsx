// tests/native/startAnnouncement.test.tsx — the announcement of who opens the
// manche lives exactly as long as the moment it describes, and holds the table
// while it does (#817).
//
// The owner watched "rotonmeta starts — lost the round" arrive late and still
// be on screen during his *second* turn: it was mounted behind the exchange
// ceremony and then ran its own fixed five seconds, with the game live
// underneath it. So the property to pin is not a duration — it is that the
// table having moved on is enough, on its own, to take the announcement away.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const WINDOW = { width: 844, height: 390, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => WINDOW,
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

// Reduced motion on throughout: a cue whose only channel is an animation goes
// silent under this preference, and the announcement must still say its piece.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable, type TurnTimerConfig } from '@/components/GameTable';
import { RANK_SLOTS, type Card, type GameState, type Player } from '@/lib/gameEngine';

const INSETS = { top: 0, left: 47, right: 0, bottom: 21 };
const METRICS = { frame: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }, insets: INSETS };

const card = (id: string): Card => ({ id, rank: '3', suit: 'spades', isJoker: false });
const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [card(`3_${i}`), card(`4_${i}`)],
  type: 'human',
});

/** The manche opens with seat 1 to play, because seat 1 lost the last round. */
const OPENER = 1;

/**
 * A manche dealt after a lost round is dealt with `firstPlayMade` already true
 * — only the very first deal of a partita starts it false — so what says the
 * opening is still to come is the rank tally, which every deal empties and
 * every play writes.
 */
function state(currentTurnIndex: number, cardsPlayed = 0): GameState {
  const playedRanks = Array.from({ length: RANK_SLOTS }, () => 0);
  playedRanks[0] = cardsPlayed;
  return {
    players: [0, 1, 2, 3].map(seat),
    currentTurnIndex,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    startReason: { type: 'lost_round', playerIdx: OPENER },
    playedRanks,
  };
}

/** The same manche, one play further in. */
const midManche = (currentTurnIndex: number) => state(currentTurnIndex, 1);

const noop = () => {};

function table(gameState: GameState, opts: { viewerSeat?: number; turnTimer?: TurnTimerConfig } = {}) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={gameState}
        viewerSeat={opts.viewerSeat ?? 0}
        turnTimer={opts.turnTimer}
        selectedIds={[]}
        onSelectCard={noop}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
      />
    </SafeAreaProvider>
  );
}

/** True when this node is withdrawn from the accessibility tree on either platform. */
const withdrawn = (props: Record<string, unknown>) =>
  props.accessibilityElementsHidden === true ||
  props.importantForAccessibility === 'no-hide-descendants' ||
  props['aria-hidden'] === true;

describe('the manche-opening announcement', () => {
  it('is on screen for the turn it names', async () => {
    const view = await render(table(state(OPENER)));

    expect(screen.getByTestId('start-reason-gate', { includeHiddenElements: true })).toBeTruthy();
    // Under reduced motion, and with nothing animating: the sentence itself is
    // what carries the cue, on a live region of its own rather than on the
    // gate, which no reader may land on.
    const alert = screen.getByRole('alert');
    expect(String(alert.props.accessibilityLabel)).toContain('P1');
    expect(withdrawn(screen.getByTestId('start-reason-gate', { includeHiddenElements: true }).props)).toBe(true);

    await view.unmount();
  });

  it('is gone the moment the table moves past that turn', async () => {
    const view = await render(table(state(OPENER)));
    expect(screen.getByTestId('start-reason-gate', { includeHiddenElements: true })).toBeTruthy();

    // One play later. Nothing about the clock has changed — this is the whole
    // claim: the announcement cannot outlive the turn it announces, however
    // much of its own reading budget is left.
    await view.rerender(table(midManche(OPENER + 1)));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await view.unmount();
  });

  it('does not come back when the same seat leads again later in the manche', async () => {
    const view = await render(table(state(OPENER)));
    await view.rerender(table(midManche(OPENER + 1)));
    // Everyone passes and the lead comes back round. The turn matching again
    // is not the manche opening again, and the announcement is spent.
    await view.rerender(table(midManche(OPENER)));

    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();

    await view.unmount();
  });

  // Online the table is never unmounted between manches — the result board is a
  // modal inside its own overlays slot — so anything the last manche spent is
  // still spent when the next one is dealt, and two manches running can carry
  // the same opener for the same reason.
  it('announces the next manche, even when the same seat opens it for the same reason', async () => {
    const view = await render(table(state(OPENER)));
    await view.rerender(table(midManche(OPENER + 1)));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();

    // A fresh deal: nothing played, and the same seat opening for the same
    // reason as last time.
    await view.rerender(table(state(OPENER)));
    expect(screen.getByTestId('start-reason-gate', { includeHiddenElements: true })).toBeTruthy();

    await view.unmount();
  });

  // `startReason` labels the whole manche and is never cleared, and the opener
  // takes the lead again every round they win. A table mounted after the
  // opening — an online reload, a rejoin, a resumed offline game — would
  // otherwise cover the felt mid-hand with the deal's own news.
  it('stays away on a table mounted after the opening was played', async () => {
    const view = await render(table(midManche(OPENER + 1)));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();

    await view.rerender(table(midManche(OPENER)));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();

    await view.unmount();
  });

  // Withdrawing the table from the reader is half of it; the other half is
  // covering it, and only the gate's own box says whether it does. A layer that
  // paints under the table gates nothing — every card and both buttons stay
  // where a finger can reach them, with nothing else in the suite the wiser.
  it('covers the whole window, over the table rather than under it', async () => {
    const view = await render(table(state(OPENER)));

    const gate = StyleSheet.flatten(
      screen.getByTestId('start-reason-gate', { includeHiddenElements: true }).props.style
    ) as Record<string, number | string>;
    expect(gate.position).toBe('absolute');
    for (const edge of ['top', 'left', 'right', 'bottom'] as const) {
      expect(gate[edge]).toBe(0);
    }

    const tableStyle = StyleSheet.flatten(
      screen.getByTestId('game-table', { includeHiddenElements: true }).props.style
    ) as Record<string, number>;
    expect(Number(gate.zIndex)).toBeGreaterThan(tableStyle.zIndex);

    await view.unmount();
  });

  // A pause the seat cannot see is worse than no pause: the clock the player is
  // charged is the one the deadline's owner keeps, so the client stops its own
  // and leaves a server's alone.
  it('stops a clock this client owns while it holds, and starts it on the way out', async () => {
    const clock: TurnTimerConfig = { seconds: 20, includeNewRound: true, pausable: true };
    const view = await render(table(state(OPENER), { viewerSeat: OPENER, turnTimer: clock }));

    // Hidden elements included both times: while the gate holds, the chip
    // carrying the countdown is withdrawn along with the rest of the table, so
    // a default query would report the clock stopped whether it was or not.
    expect(screen.queryByText('20', { includeHiddenElements: true })).toBeNull();

    await fireEvent.press(screen.getByTestId('start-reason-gate', { includeHiddenElements: true }));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('20', { includeHiddenElements: true })).toBeTruthy();

    await view.unmount();
  });

  // Online the deadline is the server's AFK window, which runs whatever this
  // client draws — so the countdown keeps going, and the scrim it goes on
  // behind stays thin enough to read it through.
  it('leaves a clock it cannot pause running, rather than drawing time the seat does not have', async () => {
    const serverClock: TurnTimerConfig = { seconds: 20, includeNewRound: true };
    const view = await render(table(state(OPENER), { viewerSeat: OPENER, turnTimer: serverClock }));

    expect(screen.getByTestId('start-reason-gate', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('20', { includeHiddenElements: true })).toBeTruthy();

    const gate = StyleSheet.flatten(
      screen.getByTestId('start-reason-gate', { includeHiddenElements: true }).props.style
    ) as Record<string, string>;
    const alpha = Number(/rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(gate.backgroundColor)?.[1] ?? '1');
    expect(alpha).toBeLessThan(1);

    await view.unmount();
  });

  it('holds the table while it is up, and hands it back afterwards', async () => {
    const view = await render(table(state(OPENER)));

    // A gate a finger cannot get past must not be one a reader can play
    // through, so the table itself is withdrawn for as long as it is up.
    expect(screen.queryByTestId('game-table')).toBeNull();
    expect(
      withdrawn(screen.getByTestId('game-table', { includeHiddenElements: true }).props)
    ).toBe(true);

    // The rail with it: a reader who can still reach the menu knob opens a
    // sheet that sits *above* the gate, with an exit in it.
    expect(
      withdrawn(screen.getByTestId('control-rail', { includeHiddenElements: true }).props)
    ).toBe(true);

    await view.rerender(table(midManche(OPENER + 1)));
    expect(screen.getByTestId('game-table')).toBeTruthy();
    expect(screen.getByTestId('control-rail')).toBeTruthy();

    await view.unmount();
  });
});
