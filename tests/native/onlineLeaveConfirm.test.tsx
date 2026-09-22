// tests/native/onlineLeaveConfirm.test.tsx — the Leave the between-hands
// overlay offers is one tap away from abandoning a scored match, so it asks
// the same question the in-table Quit asks. Rendered rather than scanned: the
// dialog is wired by a prop, and a scan cannot tell a wired one from a
// defined one.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

import { en as locale } from '@/locales/en';

const mockLeaveRoom = jest.fn();
let mockMatchOver = false;

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/lib/device/haptics', () => ({
  setHapticsMasterEnabled: jest.fn(),
  hapticsEnabled: () => false,
  hapticSelection: jest.fn(),
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticHeavy: jest.fn(),
  hapticRigid: jest.fn(),
  hapticSuccess: jest.fn(),
  hapticError: jest.fn(),
  hapticWarn: jest.fn(),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }),
}));

const mockSeat = (id: string, name: string): Player => ({
  id,
  name,
  hand: [] as Card[],
  type: 'human',
});

const mockFinished: GameState = {
  players: [mockSeat('player_0', 'Alice'), mockSeat('player_1', 'Carl')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: 0,
  gameOver: true,
  rankings: ['player_0', 'player_1'],
  firstPlayMade: true,
};

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineTable: () => ({
    gameState: mockFinished,
    mySeatIndex: 0,
    playCards: jest.fn(),
    pass: jest.fn(),
    sendReaction: jest.fn(),
    disconnectedSeats: {},
  }),
  useOnlineTurnClock: () => ({}),
  useOnlineRoom: () => ({
    isSpectator: false,
    entrySource: 'lobby',
    leaveRoom: mockLeaveRoom,
  }),
  useOnlineConnection: () => ({
    connected: true,
    error: null,
    reconnectNotice: null,
    playerLeft: false,
    rejoinFailed: false,
    clearError: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
  }),
  useOnlineMatch: () => ({
    matchState: {
      target: 21,
      length: 'match',
      over: mockMatchOver,
      winners: mockMatchOver ? ['player_0'] : [],
      isDraw: false,
      continues: !mockMatchOver,
      handsPlayed: 1,
    },
    cumulativeScores: {},
    handScores: {},
    ratingDeltas: {},
    handRecorded: true,
    rematchVoteState: null,
    endMatchVoteState: null,
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    voteRematch: jest.fn(),
    voteToEndMatch: jest.fn(),
    answerRematch: jest.fn(),
  }),
  useOnlineExchange: () => ({
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    giveExchangeCard: jest.fn(),
    acknowledgeExchange: jest.fn(),
  }),
}));

jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { overlays?: (v: object) => React.ReactNode }) =>
      react.createElement(rn.View, null, props.overlays ? props.overlays({}) : null),
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType })
  .default;

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function overlayShown() {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OnlineGameScreen />
    </SafeAreaProvider>
  );
  await act(async () => {
    jest.advanceTimersByTime(GAME_OVER_DELAY_CEILING);
  });
  return view;
}

/** Comfortably past whatever beat the screen waits before the overlay lands. */
const GAME_OVER_DELAY_CEILING = 10_000;

describe('leaving from the between-hands overlay, online', () => {
  beforeEach(() => {
    mockLeaveRoom.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks before abandoning a match that is still being scored', async () => {
    mockMatchOver = false;
    const view = await overlayShown();

    await fireEvent.press(view.getByRole('button', { name: locale['gameOverOverlay.leaveA11yLabel'] }));
    expect(mockLeaveRoom).not.toHaveBeenCalled();
    expect(view.getByText(locale['onlineGame.quitConfirmTitle'])).toBeTruthy();

    await fireEvent.press(view.getByTestId('confirm-accept'));
    expect(mockLeaveRoom).toHaveBeenCalled();

    await view.unmount();
  });

  it('asks nothing once the match is decided', async () => {
    mockMatchOver = true;
    const view = await overlayShown();

    await fireEvent.press(view.getByRole('button', { name: locale['gameOverOverlay.leaveA11yLabel'] }));
    expect(view.queryByText(locale['onlineGame.quitConfirmTitle'])).toBeNull();
    expect(mockLeaveRoom).toHaveBeenCalled();

    await view.unmount();
  });
});
