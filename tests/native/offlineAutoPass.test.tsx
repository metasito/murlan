// tests/native/offlineAutoPass.test.tsx — the offline response clock running
// out says so.
//
// Offline the countdown called the context action directly, bypassing the
// haptic a tapped PASSA gets, and there is no server to raise the banner the
// online screen shows. The turn just ended.
//
// The pass *sound* is not the screen's to play: GameTable fires it off the
// committed `passCount`, for every seat and every source of a pass. A second
// caller here would double it, so its absence is asserted.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { buildCombination, type Card, type GameState } from '@/lib/game/gameEngine';
import { useGameTable } from '@/context/GameContext';
import type { TurnTimerConfig } from '@/components/turnTimerUi';
import { state } from '../support/game';
import { offlineSave, renderAppHook } from './harness/renderApp';
import { bannerLog } from './harness/bannerLog';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const { shown, BannerLog } = bannerLog();

const c = (rank: Card['rank']): Card => ({ id: `${rank}_spades`, rank, suit: 'spades', isJoker: false });
/** Ana to answer Luan's 5♠, with cards to answer it. */
const mockState: GameState = state({
  players: [
    { id: 'player_0', name: 'Ana', hand: [c('6'), c('7')], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [c('8'), c('9')], type: 'bot' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: buildCombination([c('5')]),
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  lastMove: { seq: 1, kind: 'play', seat: 1 },
});

// The clock itself is GameTable's; what is under test is what the screen wires
// to its expiry. A button standing in for "the countdown reached zero" keeps
// the test off wall-clock timing entirely.
const mockSeenTimer: { current?: TurnTimerConfig; autoPassed?: number; onPlay?: (cardIds: string[]) => void } = {};

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { turnTimer?: TurnTimerConfig; autoPassed?: number; onPlay?: (cardIds: string[]) => void }) => {
      mockSeenTimer.current = props.turnTimer;
      mockSeenTimer.autoPassed = props.autoPassed;
      mockSeenTimer.onPlay = props.onPlay;
      return react.createElement(
        rn.Pressable,
        { testID: 'expire', onPress: () => props.turnTimer?.onExpire?.() },
        react.createElement(rn.Text, null, 'expire')
      );
    },
  };
});

import { bootFeedback, haptics, sounds } from './helpers/feedback';
import GameScreen from '@/app/game';

/** The screen over `mockState` resumed; `result.current` is the provider's table. */
const mount = () =>
  renderAppHook(() => useGameTable().gameState, {
    offline: offlineSave(mockState),
    wrap: (probe) => (
      <>
        <BannerLog />
        {probe}
        <GameScreen />
      </>
    ),
  });

describe('the offline turn clock expiring', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await bootFeedback();
  });

  it('passes with the warn haptic and tells the table, whose pass float names it, leaving the sound to the table', async () => {
    const r = await mount();
    const before = mockSeenTimer.autoPassed;

    await act(async () => {
      fireEvent.press(screen.getByTestId('expire'));
    });

    expect(haptics()).toContain('notificationWarning');
    expect(sounds()).not.toContain('pass');
    expect(shown).toEqual([]);
    expect(mockSeenTimer.autoPassed).toBe((before ?? 0) + 1);
    expect(r.result.current?.lastMove).toMatchObject({ seq: mockState.lastMove!.seq + 1, kind: 'pass', seat: 0 });
    expect(r.result.current?.currentTurnIndex).toBe(1);

    await r.unmount();
  });

  it('says nothing when the turn it was kept for has already moved on', async () => {
    const r = await mount();
    const before = mockSeenTimer.autoPassed;
    const expireForAna = mockSeenTimer.current!.onExpire!;
    await act(async () => void mockSeenTimer.onPlay?.(['6_spades']));
    const played = r.result.current;

    await act(async () => expireForAna());

    expect(haptics()).not.toContain('notificationWarning');
    expect(mockSeenTimer.autoPassed).toBe(before);
    expect(r.result.current).toBe(played);

    await r.unmount();
  });

  // Nobody else is keeping this deadline, so the table may stop it while an
  // announcement holds the felt (#817). Online the same clock is the server's
  // AFK window and this stays off, or the countdown would draw time the seat
  // has already spent.
  it('is the screen’s own to stop, and says so', async () => {
    const r = await mount();

    expect(mockSeenTimer.current?.pausable).toBe(true);

    await r.unmount();
  });
});
