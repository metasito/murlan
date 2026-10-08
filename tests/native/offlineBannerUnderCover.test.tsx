// tests/native/offlineBannerUnderCover.test.tsx — the online table stops claiming the offline note
// while its game-over overlay covers the turn pill; the pill off the table paints under that board.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';

const mockNetListeners = new Set<(state: { isConnected: boolean | null }) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (l: (state: { isConnected: boolean | null }) => void) => {
      mockNetListeners.add(l);
      return () => mockNetListeners.delete(l);
    },
  },
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'alice', username: 'Alice' } }),
}));

const mockSeat = (id: string, name: string): Player => ({ id, name, hand: [] as Card[], type: 'human' });
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

import { OfflineBanner } from '@/components/OfflineBanner';
import { en } from '@/locales/en';
const OnlineGameScreen = (require('@/app/(online)/game') as { default: React.ComponentType }).default;

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const GAME_OVER_DELAY_CEILING = 10_000;

describe('the pill off the online table', () => {
  it('stops yielding under the game-over cover', async () => {
    jest.useFakeTimers();
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnlineGameScreen />
        <OfflineBanner />
      </SafeAreaProvider>,
    );
    const live = () => screen.getByTestId('offline-banner', { includeHiddenElements: true }).props.accessibilityLiveRegion;
    await act(async () => mockNetListeners.forEach((l) => l({ isConnected: false })));
    expect(live()).toBe('none');
    await act(async () => {
      jest.advanceTimersByTime(GAME_OVER_DELAY_CEILING);
    });
    expect(screen.getByLabelText(en['gameOverOverlay.leaveA11yLabel'], { includeHiddenElements: true })).toBeTruthy();
    expect(live()).toBe('assertive');
    await view.unmount();
    jest.useRealTimers();
  });
});
