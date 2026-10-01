// tests/native/onlineErrorFloat.test.tsx — a server error on the online table is the table's own float,
// not a toast the screen paints over it.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }),
}));

const ERROR = "You can't pass";
const seat = (id: string, name: string): Player => ({ id, name, hand: [] as Card[], type: 'human' });
const mockState: GameState = {
  players: [seat('player_0', 'Alice'), seat('player_1', 'Carl')],
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

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineTable: () => ({ gameState: mockState, mySeatIndex: 0, playCards: jest.fn(), pass: jest.fn(), sendReaction: jest.fn(), disconnectedSeats: {} }),
  useOnlineTurnClock: () => ({}),
  useOnlineRoom: () => ({ isSpectator: false, entrySource: 'lobby', leaveRoom: jest.fn() }),
  useOnlineConnection: () => ({
    connected: true,
    error: { text: ERROR, seq: 1 },
    reconnectNotice: null,
    playerLeft: false,
    rejoinFailed: false,
    clearError: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
  }),
  useOnlineMatch: () => ({
    matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: false },
    cumulativeScores: {},
    handScores: {},
    ratingDeltas: {},
    handRecorded: false,
    rematchVoteState: null,
    endMatchVoteState: null,
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    voteRematch: jest.fn(),
    voteToEndMatch: jest.fn(),
    answerRematch: jest.fn(),
  }),
  useOnlineExchange: () => ({ exchangeAnnouncing: false, exchangeAnnounceData: null, giveExchangeCard: jest.fn(), acknowledgeExchange: jest.fn() }),
}));

const mockTable = jest.fn();
jest.mock('@/components/GameTable', () => {
  const react = require('react') as typeof import('react');
  const rn = require('react-native') as typeof import('react-native');
  return {
    GameTable: (props: { error?: { text: string } | null; overlays?: (v: object) => React.ReactNode }) => {
      mockTable(props.error?.text);
      return react.createElement(rn.View, null, props.overlays ? props.overlays({}) : null);
    },
  };
});

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };

describe('a server error on the online table', () => {
  it('goes to the table, and the screen paints none of its own', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    expect(mockTable).toHaveBeenLastCalledWith(ERROR);
    expect(screen.queryByText(ERROR, { includeHiddenElements: true })).toBeNull();
    await view.unmount();
  });
});
