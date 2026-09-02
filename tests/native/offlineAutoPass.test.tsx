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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { GameState } from '@/lib/gameEngine';
import type { TurnTimerConfig } from '@/components/GameTable';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/sounds', () => ({
  playCardPass: jest.fn(async () => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockPassTurn = jest.fn();
const mockShowNotification = jest.fn();

const STATE: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Luan', hand: [], type: 'ai' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: STATE,
    selectedCards: [],
    selectCard: () => {},
    playSelected: () => {},
    passTurn: mockPassTurn,
    resetGame: () => {},
    runAITurn: () => {},
    chooseExchangeCard: () => {},
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    rematchPromptOpen: false,
    rematchAnswers: {},
    rematchTally: { yes: 0, total: 0 },
    answerRematch: () => {},
    match: { length: 'single', target: 21 },
  }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

// The clock itself is GameTable's; what is under test is what the screen wires
// to its expiry. A button standing in for "the countdown reached zero" keeps
// the test off wall-clock timing entirely.
const mockSeenTimer: { current?: TurnTimerConfig } = {};

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { turnTimer?: TurnTimerConfig }) => {
      mockSeenTimer.current = props.turnTimer;
      return react.createElement(
        rn.Pressable,
        { testID: 'expire', onPress: () => props.turnTimer?.onExpire?.() },
        react.createElement(rn.Text, null, 'expire')
      );
    },
  };
});

import * as Haptics from 'expo-haptics';
import { playCardPass } from '@/lib/sounds';
import { t } from '@/lib/i18n';
import GameScreen from '@/app/game';

describe('the offline turn clock expiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes with the warn haptic and a banner naming it, leaving the sound to the table', async () => {
    const r = await render(<GameScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('expire'));
    });

    expect(jest.mocked(Haptics.notificationAsync)).toHaveBeenCalledWith('warning');
    expect(playCardPass).not.toHaveBeenCalled();
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'afk', title: t('game.autoPassTitle') })
    );
    expect(mockPassTurn).toHaveBeenCalledTimes(1);

    await r.unmount();
  });

  // Nobody else is keeping this deadline, so the table may stop it while an
  // announcement holds the felt (#817). Online the same clock is the server's
  // AFK window and this stays off, or the countdown would draw time the seat
  // has already spent.
  it('is the screen’s own to stop, and says so', async () => {
    const r = await render(<GameScreen />);

    expect(mockSeenTimer.current?.pausable).toBe(true);

    await r.unmount();
  });
});
