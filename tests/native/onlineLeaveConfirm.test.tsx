// tests/native/onlineLeaveConfirm.test.tsx — the in-table Quit between manches
// is one tap away from abandoning a scored match, so it asks; the results
// overlay's Leave, over a decided match, does not. Rendered rather than
// scanned: the dialog is wired by a prop, and a scan cannot tell a wired one
// from a defined one.
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
    retryConnection: jest.fn(),
    ownLink: 'up',
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
    handScoresCurrent: true,
    rematchVoteState: null,
    endMatchVoteState: null,
    voteRematch: jest.fn(),
    voteToEndMatch: jest.fn(),
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
    GameTable: (props: {
      onQuit: () => void;
      partitaActions?: { onHome: () => void };
      gameState: { gameOver: boolean };
      matchOver: boolean;
      overlays?: (v: object) => React.ReactNode;
    }) =>
      react.createElement(
        rn.View,
        null,
        react.createElement(rn.Pressable, { testID: 'table-quit', onPress: props.onQuit }),
        props.partitaActions && props.gameState.gameOver && props.matchOver
          ? react.createElement(rn.Pressable, { testID: 'btn-home', onPress: props.partitaActions.onHome })
          : null,
        props.overlays ? props.overlays({}) : null
      ),
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

/** Comfortably past the partita ending's settled board. */
const GAME_OVER_DELAY_CEILING = 10_000;

describe('leaving between hands, online', () => {
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
    expect(view.queryByTestId('btn-home', { includeHiddenElements: true })).toBeNull();

    await fireEvent.press(view.getByTestId('table-quit'));
    expect(mockLeaveRoom).not.toHaveBeenCalled();
    expect(view.getByText(locale['onlineGame.quitConfirmTitle'])).toBeTruthy();

    await fireEvent.press(view.getByTestId('confirm-accept'));
    expect(mockLeaveRoom).toHaveBeenCalled();

    await view.unmount();
  });

  it('asks nothing once the match is decided', async () => {
    mockMatchOver = true;
    const view = await overlayShown();

    await fireEvent.press(view.getByTestId('btn-home', { includeHiddenElements: true }));
    expect(view.queryByText(locale['onlineGame.quitConfirmTitle'])).toBeNull();
    expect(mockLeaveRoom).toHaveBeenCalled();

    await view.unmount();
  });
});
