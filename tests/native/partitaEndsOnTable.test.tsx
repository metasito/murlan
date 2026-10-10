// tests/native/partitaEndsOnTable.test.tsx — the last manche of a partita ends on the felt, offline
// and online: no route change and no results overlay; the score pill becomes the board with the
// winner and both actions; a tap during the ending, or reduced motion, jumps to the settled board.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ReduceMotion, ReducedMotionConfig, getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setMotionPreference } from '@/lib/accessibility';
import type { GameState, Player } from '@/lib/game/gameEngine';
import { partitaEndingOnsets } from '@/lib/game/partitaEnding';
import { t } from '@/lib/i18n';

const seat = (i: number): Player => ({ id: `player_${i}`, name: ['Ana', 'Luan', 'Erion', 'Besa'][i], hand: [], type: i === 0 ? 'human' : 'ai' });
const MOCK_ENDED: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_1', 'player_0', 'player_2', 'player_3'],
  firstPlayMade: true,
};
const MOCK_SCORES = { player_0: 12, player_1: 22, player_2: 6, player_3: 3 };
const MOCK_HAND = { player_0: 1, player_1: 3, player_2: 0, player_3: 0 };
const MOCK_MATCH = { target: 21, over: true, winners: ['player_1'], isDraw: false, continues: true, handsPlayed: 6 };

const mockStartNewMatch = jest.fn();
const mockResetGame = jest.fn();
const mockVoteRematch = jest.fn();
let mockVotes: { votes: string[]; total: number } | null = null;

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));
jest.mock('@/context/NotificationContext', () => ({ useNotification: () => ({ showNotification: jest.fn() }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }) }));
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: MOCK_ENDED,
    chooseExchangeCard: () => {},
    releaseStuckExchange: () => {},
    playCards: () => {},
    passTurn: () => {},
    resetGame: mockResetGame,
    runAITurn: () => {},
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    startNextHand: () => {},
    startNewMatch: mockStartNewMatch,
    match: { ...MOCK_MATCH, length: 'match', scores: MOCK_SCORES, hands: [{ pointsAwarded: MOCK_HAND, rankings: MOCK_ENDED.rankings }] },
  }),
}));
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineTable: () => ({
    gameState: MOCK_ENDED,
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
    matchState: { ...MOCK_MATCH, length: 'match' },
    cumulativeScores: MOCK_SCORES,
    handScores: MOCK_HAND,
    handScoresCurrent: true,
    ratingDeltas: {},
    handRecorded: true,
    rematchVoteState: mockVotes,
    endMatchVoteState: null,
    voteRematch: mockVoteRematch,
    voteToEndMatch: jest.fn(),
  }),
  useOnlineExchange: () => ({
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    giveExchangeCard: jest.fn(),
    acknowledgeExchange: jest.fn(),
  }),
}));

const OfflineGameScreen = (require('@/app/game') as { default: React.ComponentType }).default;
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const HIDDEN = { includeHiddenElements: true };
const { board, settled } = partitaEndingOnsets(4);
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const wrap = (Screen: React.ComponentType) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ReducedMotionConfig mode={ReduceMotion.Always} />
    <Screen />
  </SafeAreaProvider>
);
const pressable = (testID: string) => {
  const button = screen.queryByTestId(testID, HIDDEN);
  return button !== null && button.props.accessibilityState?.disabled !== true;
};
const dim = () => getAnimatedStyle(screen.getByTestId('partita-dim', HIDDEN)).opacity;
const tap = () =>
  fireEvent(screen.getByTestId('pile-area', HIDDEN), 'startShouldSetResponderCapture', { nativeEvent: { pageX: 0, pageY: 0 } });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockVotes = null;
});
afterEach(() => {
  jest.useRealTimers();
  setMotionPreference('system');
});

describe.each<[string, React.ComponentType, string]>([
  ['offline', OfflineGameScreen, 'btn-nuova-partita'],
  ['online', OnlineGameScreen, 'btn-rivincita'],
])('a partita ending %s', (_where, Screen, againID) => {
  it('stays on the table and settles on the board with the winner and both actions', async () => {
    const view = await render(wrap(Screen));
    await advance(board - 100);
    expect(screen.queryByTestId('partita-winner', HIDDEN)).toBeNull();
    expect(pressable(againID)).toBe(false);

    await advance(settled);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('winner-celebration', HIDDEN)).toBeNull();
    expect(screen.getByTestId('partita-winner-name', HIDDEN)).toHaveTextContent('Luan');
    expect(screen.getAllByText(t('partitaBoard.wins'), HIDDEN).length).toBeGreaterThan(0);
    expect(screen.getByTestId('score-pill-winner-row', HIDDEN)).toHaveTextContent('1');
    expect(dim()).toBeCloseTo(0.6);
    expect(pressable('btn-home')).toBe(true);
    expect(pressable(againID)).toBe(true);
    await view.unmount();
  });

  it('a tap during the ending jumps to the settled board', async () => {
    const view = await render(wrap(Screen));
    await advance(board - 600);
    expect(pressable(againID)).toBe(false);
    await tap();
    await advance(16);
    expect(pressable(againID)).toBe(true);
    expect(dim()).toBeCloseTo(0.6);
    await view.unmount();
  });

  it('under reduced motion, the board is settled at once', async () => {
    setMotionPreference('on');
    const view = await render(wrap(Screen));
    await advance(16);
    expect(pressable(againID)).toBe(true);
    expect(screen.getByTestId('partita-winner-name', HIDDEN)).toHaveTextContent('Luan');
    await view.unmount();
  });
});

describe('Nuova partita on the board', () => {
  it('starts a new partita offline, with no route change', async () => {
    const view = await render(wrap(OfflineGameScreen));
    await advance(settled + 100);
    await fireEvent.press(screen.getByTestId('btn-nuova-partita', HIDDEN));
    expect(mockStartNewMatch).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('btn-home', HIDDEN));
    expect(mockResetGame).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
    await view.unmount();
  });

  it('sends the rematch vote online and shows its count', async () => {
    const view = await render(wrap(OnlineGameScreen));
    await advance(settled + 100);
    await fireEvent.press(screen.getByTestId('btn-rivincita', HIDDEN));
    expect(mockVoteRematch).toHaveBeenCalledTimes(1);

    mockVotes = { votes: ['alice'], total: 4 };
    await act(async () => view.rerender(wrap(OnlineGameScreen)));
    expect(screen.getAllByText(t('gameOverOverlay.nextHandWaiting', { count: 1, total: 4 }), HIDDEN).length).toBe(1);
    expect(pressable('btn-rivincita')).toBe(false);
    await view.unmount();
  });
});
