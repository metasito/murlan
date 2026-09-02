// tests/native/onlinePartitaShake.test.tsx — the partita rung, online.
//
// `game:state` (gameOver true) and `game:over` (matchOver true) are two
// socket packets, two renders — `matchOverRef` (components/GameTable.tsx)
// is what lets the impact timeout scheduled on the first read the second
// when it fires, rather than the value closed over when it was scheduled.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

// Real timing: the whole point is the window between the two packets and
// the impact firing.
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

const mockShakeCalls: string[] = [];
jest.mock('@/components/useTableFeedback', () => {
  const actual: any = jest.requireActual('@/components/useTableFeedback');
  return {
    ...actual,
    useTableFeedback: (input: any) => {
      const real = actual.useTableFeedback(input);
      return {
        ...real,
        shake: (tier: any) => {
          mockShakeCalls.push(tier);
          return real.shake(tier);
        },
      };
    },
  };
});

import { GameTable } from '@/components/GameTable';
import { impactDelayMs } from '@/components/gameTableModel';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });
const CARD: Card = { id: 'K_hearts', rank: 'K', suit: 'hearts', isJoker: false };
const WINNING_PLAY: Combination = { type: 'single', cards: [CARD], strength: 13 };

const noop = () => {};
const table = (gameState: GameState, matchOver: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      matchOver={matchOver}
      viewerSeat={1}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

/** The hand-emptying play that closed it, exactly as `game:state` reports it. */
const HAND_CLOSED: GameState = {
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: WINNING_PLAY,
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_1', 'player_0'],
  firstPlayMade: true,
};

describe('the partita rung, across the two online packets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShakeCalls.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires partitaWon when matchOver arrives in its own render before the impact timeout', async () => {
    const r = await render(table(HAND_CLOSED, false));

    // `game:over` lands a render later, matchOver flips with the same
    // gameState — the pile effect's own key guard skips re-scheduling.
    await act(async () => r.rerender(table(HAND_CLOSED, true)));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockShakeCalls).toContain('partitaWon');
    expect(mockShakeCalls).not.toContain('mancheWon');

    await r.unmount();
  });

  it('fires mancheWon when no matchOver packet ever arrives', async () => {
    const r = await render(table(HAND_CLOSED, false));

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) + 10);
      jest.runOnlyPendingTimers();
    });

    expect(mockShakeCalls).toContain('mancheWon');
    expect(mockShakeCalls).not.toContain('partitaWon');

    await r.unmount();
  });
});
