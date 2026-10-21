// tests/native/roundEndsOnTable.test.tsx — offline, a round ends on the table and the next one
// is dealt from the landing that ended it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { GameState } from '@/lib/game/gameEngine';
import { RoundEnding } from '@/lib/tokens';
import { aThreePlayed, state } from '../support/game';
import { useGameTable } from '@/context/GameContext';
import { offlineSave, renderAppHook } from './harness/renderApp';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

type TableProps = { onRoundLanded?: (landsAt: number) => void; onPlay?: (cardIds: string[]) => void };
const mockTable: { props: TableProps } = { props: {} };

const mockOver: GameState = state({
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [], type: 'bot' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: true,
  finishingOrder: ['player_0', 'player_1'],
  firstPlayMade: true,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
});

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: TableProps) => {
      mockTable.props = props;
      return react.createElement(rn.View, { testID: 'table' });
    },
  };
});

import GameScreen from '@/app/game';

const LONG_AFTER = 10_000;

/** One card left in Ana's hand, hers to lead: playing it ends the round, and in a single match the match. */
const LAST_CARD: GameState = state({
  ...mockOver,
  players: [
    { id: 'player_0', name: 'Ana', hand: [{ id: '3_spades', rank: '3', suit: 'spades', isJoker: false }], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [{ id: '4_spades', rank: '4', suit: 'spades', isJoker: false }], type: 'bot' },
  ],
  roundOver: false,
  finishingOrder: [],
});

let seen: (GameState | null)[] = [];
const useRecordedTable = () => {
  const { gameState } = useGameTable();
  if (seen.at(-1) !== gameState) seen.push(gameState);
  return gameState;
};
/** Rounds dealt since the screen mounted: each one takes a finished table back to a live one. */
const deals = () => seen.filter((s, i) => i > 0 && s && !s.roundOver && seen[i - 1]?.roundOver).length;

const mount = async (save = offlineSave(mockOver, { length: 'match' })) => {
  seen = [];
  return renderAppHook(useRecordedTable, {
    offline: save,
    wrap: (probe) => (
      <>
        {probe}
        <GameScreen />
      </>
    ),
  });
};

describe('the end of a round, offline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockTable.props = {};
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deals the next round once, at the ending landing plus the deal onset, and never changes route', async () => {
    const view = await mount();
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(deals()).toBe(0);

    await act(async () => mockTable.props.onRoundLanded?.(performance.now()));
    await act(async () => {
      jest.advanceTimersByTime(RoundEnding.deal - 1);
    });
    expect(deals()).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(deals()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(deals()).toBe(1);
    expect(router.replace).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('a landing reported late still deals at its own onset', async () => {
    const view = await mount();
    const landedAt = performance.now();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await act(async () => mockTable.props.onRoundLanded?.(landedAt));
    await act(async () => {
      jest.advanceTimersByTime(RoundEnding.deal - 1_000);
    });
    expect(deals()).toBe(1);
    await view.unmount();
  });

  it('leaving before the deal cancels it', async () => {
    const view = await mount();
    await act(async () => mockTable.props.onRoundLanded?.(performance.now()));
    await view.unmount();
    jest.advanceTimersByTime(LONG_AFTER);
    expect(deals()).toBe(0);
  });

  it('a match ends on the table too, and the table is not asked to deal', async () => {
    const view = await mount(offlineSave(LAST_CARD, { length: 'single' }));
    await act(async () => void mockTable.props.onPlay?.(['3_spades']));
    expect(view.result.current?.roundOver).toBe(true);
    expect(mockTable.props.onRoundLanded).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(LONG_AFTER);
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(deals()).toBe(0);
    await view.unmount();
  });
});
