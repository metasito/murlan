// tests/native/firstRoundWaitsForDeal.test.tsx — the first round's opener waits for the deal to land (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Rank, Suit } from '@/lib/game/gameEngine';
import { dealEndMs } from '@/lib/game/dealTimeline';
import { OFFLINE_BOT_DELAY_MS } from '@/lib/game/offlineBotDelay';
import { Motion } from '@/lib/tokens';
import { steps } from './helpers/steps';
import { bootFeedback } from './helpers/feedback';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const mockRunBotTurn = jest.fn();

const RANKS: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const hand = (suit: Suit): Card[] => RANKS.map((rank) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false }));

/** Four seats dealt thirteen each; the bot in seat 1 holds the 3♠ and opens. */
const mockOpening: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: hand('hearts'), type: 'human' },
    { id: 'player_1', name: 'Luan', hand: hand('spades'), type: 'bot' },
    { id: 'player_2', name: 'Besnik', hand: hand('clubs'), type: 'bot' },
    { id: 'player_3', name: 'Gent', hand: hand('diamonds'), type: 'bot' },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: false,
  startCard: hand('spades')[0],
};
const DEAL_ENDS = dealEndMs(SUITS.map(() => RANKS.length), Motion.duration.reveal);

jest.mock('@/context/GameContext', () => ({
  useGame: () => ({
    gameState: mockOpening,
    chooseExchangeCard: () => {},
    releaseStuckExchange: () => {},
    playCards: () => {},
    passTurn: () => {},
    resetGame: () => {},
    runBotTurn: mockRunBotTurn,
    exchangeAnnouncing: false,
    exchangeAnnounceData: null,
    acknowledgeExchange: () => {},
    startNextRound: () => {},
    startNewMatch: () => {},
    match: { length: 'single', target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false },
  }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

import GameScreen from '@/app/game';

describe('the first round, offline', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds the bot holding the 3♠ until the deal has landed, then plays', async () => {
    expect(DEAL_ENDS).toBeGreaterThan(OFFLINE_BOT_DELAY_MS + 200);
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        <GameScreen />
      </SafeAreaProvider>
    );
    await steps(OFFLINE_BOT_DELAY_MS + 100);
    expect(mockRunBotTurn).not.toHaveBeenCalled();

    await steps(DEAL_ENDS - OFFLINE_BOT_DELAY_MS + 100);
    expect(mockRunBotTurn).not.toHaveBeenCalled();
    await steps(OFFLINE_BOT_DELAY_MS + 100);
    expect(mockRunBotTurn).toHaveBeenCalledTimes(1);
    await view.unmount();
  }, 30_000);
});
