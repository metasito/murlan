// tests/native/onlineMancheEndsOnTable.test.tsx — online, a manche ends on the table: no results
// overlay, the score pill holds open with the next-hand vote at its foot, and the next deal closes it.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setMotionPreference } from '@/lib/accessibility';
import type { GameState, Player } from '@/lib/game/gameEngine';
import { mancheEndingOnsets } from '@/lib/game/mancheEnding';
import { t } from '@/lib/i18n';

const mockVoteRematch = jest.fn();
const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [], type: i === 0 ? 'human' : 'ai' });
const ENDED: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1', 'player_2', 'player_3'],
  firstPlayMade: true,
};
const DEALT: GameState = { ...ENDED, gameOver: false, rankings: [], firstPlayMade: false };
let mockGameState: GameState = ENDED;
let mockScoresCurrent = true;
let mockVotes: { votes: string[]; total: number } | null = null;

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }) }));
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineTable: () => ({
    gameState: mockGameState,
    mySeatIndex: 0,
    playCards: jest.fn(),
    pass: jest.fn(),
    sendReaction: jest.fn(),
    disconnectedSeats: {},
  }),
  useOnlineTurnClock: () => ({}),
  useOnlineRoom: () => ({ isSpectator: false, entrySource: 'lobby', leaveRoom: jest.fn() }),
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
    matchState: { target: 21, length: 'match', over: false, winners: [], isDraw: false, continues: true, handsPlayed: 1 },
    cumulativeScores: { player_0: 10, player_1: 4, player_2: 2, player_3: 1 },
    handScores: { player_0: 3, player_1: 1, player_2: 0, player_3: 0 },
    handScoresCurrent: mockScoresCurrent,
    ratingDeltas: {},
    handRecorded: true,
    rematchVoteState: mockVotes,
    endMatchVoteState: null,
    rematchIntents: { yes: 0, total: 0, answers: {} },
    rematchPromptOpen: false,
    voteRematch: mockVoteRematch,
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

const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const HIDDEN = { includeHiddenElements: true };
const { close, settled } = mancheEndingOnsets(4);
const screenNow = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <OnlineGameScreen />
  </SafeAreaProvider>
);
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const pillOpen = () => getAnimatedStyle(screen.getByTestId('score-pill-panel', HIDDEN)).display === 'flex';
const voteShown = () => getAnimatedStyle(screen.getByTestId('manche-vote', HIDDEN)).display === 'flex';
const voteButton = () => screen.queryByRole('button', { name: t('gameOverOverlay.nextHandA11yLabel'), ...HIDDEN });
const overlayLeave =() => screen.queryByRole('button', { name: t('gameOverOverlay.leaveA11yLabel') });

beforeEach(() => {
  jest.useFakeTimers();
  mockGameState = ENDED;
  mockScoresCurrent = true;
  mockVotes = null;
  mockVoteRematch.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
  setMotionPreference('system');
});

describe('a manche ending online', () => {
  it('holds the pill open with the vote at its foot, no overlay, until the next deal', async () => {
    const view = await render(screenNow());
    await advance(close + settled);
    expect(overlayLeave()).toBeNull();
    expect(pillOpen()).toBe(true);
    expect(voteShown()).toBe(true);
    expect(within(screen.getByTestId('manche-vote', HIDDEN)).getAllByText('0/4', HIDDEN).length).toBe(1);

    await fireEvent.press(voteButton()!);
    expect(mockVoteRematch).toHaveBeenCalledTimes(1);

    mockVotes = { votes: ['alice'], total: 4 };
    await act(async () => view.rerender(screenNow()));
    expect(screen.getAllByText(t('gameOverOverlay.nextHandWaiting', { count: 1, total: 4 }), HIDDEN).length).toBeGreaterThan(0);
    expect(pillOpen()).toBe(true);

    mockGameState = DEALT;
    mockVotes = null;
    await act(async () => view.rerender(screenNow()));
    await advance(settled);
    expect(pillOpen()).toBe(false);
    expect(screen.queryByTestId('manche-vote', HIDDEN)).toBeNull();
    await view.unmount();
  });

  it('under reduced motion, the next deal closes the held pill at once', async () => {
    setMotionPreference('on');
    const view = await render(screenNow());
    await advance(close + settled);
    expect(pillOpen()).toBe(true);

    mockGameState = DEALT;
    await act(async () => view.rerender(screenNow()));
    await advance(16);
    expect(pillOpen()).toBe(false);
    await view.unmount();
  });

  it("waits for this manche's scores before the pill opens", async () => {
    mockScoresCurrent = false;
    const view = await render(screenNow());
    await advance(close + settled);
    expect(overlayLeave()).toBeNull();
    expect(pillOpen()).toBe(false);

    mockScoresCurrent = true;
    await act(async () => view.rerender(screenNow()));
    await advance(close);
    expect(pillOpen()).toBe(true);
    await view.unmount();
  });
});
