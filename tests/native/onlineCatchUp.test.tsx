// tests/native/onlineCatchUp.test.tsx — another seat dropping or coming back is a notice, not this
// table replaying: every throw keeps the full flight while the notice is up.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const mockTableProps = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }),
}));

const mockSeat = (id: string, name: string): Player => ({ id, name, hand: [] as Card[], type: 'human' });
const mockMidHand: GameState = {
  players: [mockSeat('player_0', 'Alice'), mockSeat('player_1', 'Carl')],
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
  useOnlineTable: () => ({
    gameState: mockMidHand,
    mySeatIndex: 0,
    playCards: jest.fn(),
    pass: jest.fn(),
    sendReaction: jest.fn(),
    disconnectedSeats: { 1: { seconds: 30, resetKey: '1|0' } },
  }),
  useOnlineTurnClock: () => ({}),
  useOnlineRoom: () => ({ isSpectator: false, entrySource: 'lobby', leaveRoom: jest.fn() }),
  useOnlineConnection: () => ({
    connected: true,
    error: null,
    reconnectNotice: 'Carl disconnected',
    playerLeft: false,
    rejoinFailed: false,
    clearError: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
  }),
  useOnlineMatch: () => ({
    matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: true, handsPlayed: 0 },
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
  useOnlineExchange: () => ({
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    giveExchangeCard: jest.fn(),
    acknowledgeExchange: jest.fn(),
  }),
}));

jest.mock('@/components/GameTable', () => ({
  GameTable: (props: object) => {
    mockTableProps(props);
    return null;
  },
}));

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

describe('the online table under a reconnect notice', () => {
  it('throws at the full flight while another seat is away', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    expect(mockTableProps).toHaveBeenCalled();
    for (const [props] of mockTableProps.mock.calls) expect((props as { catchUp?: boolean }).catchUp ?? false).toBe(false);
    await view.unmount();
  });
});
