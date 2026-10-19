// tests/native/dealWatchdog.test.tsx — a deal whose frames never run still releases the exchange, and says so (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { AppState } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/components/table/deal', () => ({
  ...jest.requireActual<object>('@/components/table/deal'),
  __esModule: true,
  DealFlights: () => null,
}));
jest.mock('@/lib/errorReporting', () => ({
  ...jest.requireActual<object>('@/lib/errorReporting'),
  __esModule: true,
  reportError: jest.fn(() => true),
}));

import { GameTable } from '@/components/GameTable';
import { reportError } from '@/lib/errorReporting';
import { GATE_WATCHDOG_MS } from '@/lib/timeline/gateWatchdog';
import { choiceOpensAt } from '@/lib/timeline/exchangeTimeline';
import { emptyRankTally, type Card, type GameState, type Player, type Rank, type Suit } from '@/lib/game/gameEngine';
import { steps } from './helpers/steps';
import { bootFeedback } from './helpers/feedback';

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });

const exchange: GameState = {
  players: [
    seat('player_0', 'Ana', [card('5', 'hearts'), card('9', 'clubs'), card('K', 'diamonds'), card('A', 'spades')]),
    seat('player_1', 'Bea', [card('4', 'clubs')]),
    seat('player_2', 'Cesk', [card('6', 'hearts')]),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  playedRanks: emptyRankTally(),
  exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), twoJokerException: false },
};

const prompt = () => screen.queryByTestId('exchange-prompt');

describe('a deal whose frame clock never advances', () => {
  let was: typeof AppState.currentState;
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.mocked(reportError).mockClear();
    was = AppState.currentState;
    await bootFeedback();
  });
  afterEach(() => {
    AppState.currentState = was;
    jest.useRealTimers();
  });

  it('opens the exchange once the gate watchdog has passed, and reports the deal gate', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        <GameTable gameState={exchange} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
      </SafeAreaProvider>
    );
    await act(async () => jest.advanceTimersByTime(GATE_WATCHDOG_MS - 500));
    expect({ prompt: prompt() !== null, reported: jest.mocked(reportError).mock.calls.length }).toEqual({ prompt: false, reported: 0 });

    await steps(500 + choiceOpensAt(false) + 200);
    expect(prompt()).not.toBeNull();
    expect(jest.mocked(reportError).mock.calls.map(([e]) => (e as Error).message)).toEqual(['table gate forced: deal']);
    await view.unmount();
  }, 60_000);

  it('forces nothing while the page is hidden', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        <GameTable gameState={exchange} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
      </SafeAreaProvider>
    );
    await act(async () => jest.advanceTimersByTime(500));
    AppState.currentState = 'background';
    await act(async () => jest.advanceTimersByTime(GATE_WATCHDOG_MS * 3));
    expect({ prompt: prompt() !== null, reported: jest.mocked(reportError).mock.calls.length }).toEqual({ prompt: false, reported: 0 });
    await view.unmount();
  }, 60_000);
});
