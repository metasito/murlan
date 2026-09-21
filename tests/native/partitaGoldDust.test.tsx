// tests/native/partitaGoldDust.test.tsx — gold dust behind the trophy marks a
// partita the viewer won, and nothing else (#1102).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
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
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ResultScreen from '@/app/result';
import { setMotionPreference } from '@/lib/accessibility';
import type { GameState, Player } from '@/lib/gameEngine';
import type { MatchState } from '@/context/GameContext';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const human = (id: string, name: string): Player => ({ id, name, hand: [], type: 'human' });
const ai = (id: string, name: string): Player => ({ id, name, hand: [], type: 'ai' });

let mockState: GameState;
let mockMatch: MatchState;

function table(winner: 'player_0' | 'player_1', over: boolean) {
  const loser = winner === 'player_0' ? 'player_1' : 'player_0';
  mockState = {
    players: [human('player_0', 'Ana'), ai('player_1', 'Besi')],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: true,
    rankings: [winner, loser],
    firstPlayMade: true,
  };
  mockMatch = {
    length: 'match',
    target: 21,
    scores: { [winner]: over ? 21 : 3, [loser]: 0 },
    hands: [{ rankings: [winner, loser], pointsAwarded: { [winner]: 3, [loser]: 0 } }],
    over,
    winners: over ? [winner] : [],
    isDraw: false,
  };
}

async function flakes(reduce: boolean): Promise<number> {
  setMotionPreference(reduce ? 'on' : 'off');
  const view = await render(<SafeAreaProvider initialMetrics={METRICS}><ResultScreen /></SafeAreaProvider>);
  await act(async () => {});
  const n = screen.queryAllByTestId('gold-flake').length;
  await view.unmount();
  return n;
}

describe('gold dust for the partita win', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => {},
    } as ReturnType<typeof AccessibilityInfo.addEventListener>);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(async () => {
    await act(async () => setMotionPreference('system'));
    jest.restoreAllMocks();
  });

  it('bursts 24 flakes when the viewer wins the partita', async () => {
    table('player_0', true);
    expect(await flakes(false)).toBe(24);
  });

  it('has none for a manche the viewer won', async () => {
    table('player_0', false);
    expect(await flakes(false)).toBe(0);
  });

  it('has none for a partita someone else won', async () => {
    table('player_1', true);
    expect(await flakes(false)).toBe(0);
  });

  it('has none under reduced motion', async () => {
    table('player_0', true);
    expect(await flakes(true)).toBe(0);
  });
});
