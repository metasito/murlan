// tests/native/onlineCatchUp.test.tsx — another seat dropping or coming back is a notice, not this
// table replaying: every throw keeps the full flight while the notice is up.
import { afterEach, describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const mockTableProps = jest.fn();
const mockRetry = jest.fn();
const mockOwnLink = { current: 'up' };

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
    reconnectNotice: { text: 'Carl disconnected', back: false },
    playerLeft: false,
    rejoinFailed: false,
    clearError: jest.fn(),
    clearPlayerLeft: jest.fn(),
    clearRejoinFailed: jest.fn(),
    retryConnection: mockRetry,
    ownLink: mockOwnLink.current,
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

type Connection = { state: string; action?: { onPress: () => void } } | null;
const lastTable = () => mockTableProps.mock.calls.at(-1)![0] as { ownLink: string; catchUp: boolean; connection: Connection };

describe("the online table on the viewer's own link", () => {
  afterEach(() => {
    mockOwnLink.current = 'up';
    mockTableProps.mockClear();
  });

  it('catches up on the way back, under the back pill', async () => {
    mockOwnLink.current = 'back';
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    expect(lastTable()).toMatchObject({ ownLink: 'back', catchUp: true, connection: { state: 'back' } });
    await view.unmount();
  });

  it('offers Riprova once given up, and Riprova retries the connection', async () => {
    mockOwnLink.current = 'lost';
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
      </SafeAreaProvider>
    );
    const { connection, catchUp } = lastTable();
    expect(connection?.state).toBe('lost');
    expect(catchUp).toBe(false);
    connection?.action?.onPress();
    expect(mockRetry).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
