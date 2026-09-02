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
import { render, screen } from '@testing-library/react-native';
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

import { GameTable } from '@/components/GameTable';
import type { Card, GameState, Player } from '@/lib/gameEngine';

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

function state(currentTurnIndex: number): GameState {
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
  };
}

const noop = () => {};

function table(gameState: GameState) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={gameState}
        viewerSeat={0}
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
    await view.rerender(table(state(OPENER + 1)));
    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await view.unmount();
  });

  it('does not come back when the same seat leads again later in the manche', async () => {
    const view = await render(table(state(OPENER)));
    await view.rerender(table(state(OPENER + 1)));
    // Everyone passes and the lead comes back round. The turn matching again
    // is not the manche opening again, and the announcement is spent.
    await view.rerender(table(state(OPENER)));

    expect(screen.queryByTestId('start-reason-gate', { includeHiddenElements: true })).toBeNull();

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

    await view.rerender(table(state(OPENER + 1)));
    expect(screen.getByTestId('game-table')).toBeTruthy();

    await view.unmount();
  });
});
