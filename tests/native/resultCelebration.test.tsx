// tests/native/resultCelebration.test.tsx — the result screen's verdict lands
// once.
//
// `usePrefersReducedMotion` starts at false and settles from a promise after
// the first paint, so anything the celebration's motion effect does runs a
// second time on every device with OS Reduce Motion on. A spring restarting
// there is cosmetic; a success haptic firing twice is the player being told
// they won twice.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

// The factory is hoisted above every import, so it cannot close over a const
// declared below — it reads these back at render time instead, which is what
// the `mock` prefix permits.
jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockState,
    match: mockMatch,
    tableWantsRematch: false,
    startNextHand: () => {},
    startNewMatch: () => {},
    chooseExchangeCard: () => {},
    resetGame: () => {},
  }),
}));

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import ResultScreen from '@/app/result';
import { setMotionPreference } from '@/lib/accessibility';
import type { GameState, Player } from '@/lib/gameEngine';
import type { MatchState } from '@/context/GameContext';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });

/** A finished hand with no exchange pending, so the celebration is what renders. */
const mockState: GameState = {
  players: [seat('player_0', 'Ana'), seat('player_1', 'Besi')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1'],
  firstPlayMade: true,
};

const mockMatch: MatchState = {
  length: 'match',
  target: 21,
  scores: { player_0: 3, player_1: 0 },
  hands: [{ rankings: ['player_0', 'player_1'], pointsAwarded: { player_0: 3, player_1: 0 } }],
  over: false,
  winners: [],
  isDraw: false,
};

const notificationAsync = Haptics.notificationAsync as unknown as ReturnType<typeof jest.fn>;

describe('the result screen celebrates once', () => {
  beforeEach(() => {
    setMotionPreference('system');
    notificationAsync.mockClear();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => {},
    } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  });

  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
  });

  // The regression this exists for: the OS setting arrives after the first
  // paint, so a haptic on the motion effect fires once for each answer.
  it('fires the verdict haptic once when the OS asks to reduce motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const view = await render(<SafeAreaProvider initialMetrics={METRICS}><ResultScreen /></SafeAreaProvider>);
    await act(async () => {});

    expect(notificationAsync).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('fires it once with full motion too', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const view = await render(<SafeAreaProvider initialMetrics={METRICS}><ResultScreen /></SafeAreaProvider>);
    await act(async () => {});

    expect(notificationAsync).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  // The in-app override is pushed through useSyncExternalStore, which is the
  // other way the preference changes under a mounted celebration.
  it('does not celebrate again when the player turns motion down mid-screen', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const view = await render(<SafeAreaProvider initialMetrics={METRICS}><ResultScreen /></SafeAreaProvider>);
    await act(async () => {});
    expect(notificationAsync).toHaveBeenCalledTimes(1);

    await act(async () => setMotionPreference('on'));

    expect(notificationAsync).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
