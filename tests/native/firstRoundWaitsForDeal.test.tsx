// tests/native/firstRoundWaitsForDeal.test.tsx — the first round's opener waits for the deal to land (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Card, GameState, Rank, Suit } from '@/lib/game/gameEngine';
import { dealEndMs } from '@/lib/timeline/dealTimeline';
import { OFFLINE_BOT_DELAY_MS } from '@/lib/timeline/offlineBotDelay';
import { Motion } from '@/lib/tokens';
import { steps } from './helpers/steps';
import { bootFeedback } from './helpers/feedback';
import { state } from '../support/game';
import { useGameTable } from '@/context/GameContext';
import { offlineSave, renderAppHook } from './harness/renderApp';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const RANKS: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const hand = (suit: Suit): Card[] => RANKS.map((rank) => card(rank, suit));

const opening = (players: GameState['players']): GameState => state({
  players,
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: false,
  lastMove: { seq: 0, kind: 'deal' },
  startCard: hand('spades')[0],
});

/** The bot in seat 1 holds the 3♠ and opens, at either table shape. */
const TABLES: [string, GameState][] = [
  [
    'four seats',
    opening([
      { id: 'player_0', name: 'Ana', hand: hand('hearts'), type: 'human' },
      { id: 'player_1', name: 'Luan', hand: hand('spades'), type: 'bot' },
      { id: 'player_2', name: 'Besnik', hand: hand('clubs'), type: 'bot' },
      { id: 'player_3', name: 'Gent', hand: hand('diamonds'), type: 'bot' },
    ]),
  ],
  [
    'two seats',
    opening([
      { id: 'player_0', name: 'Ana', hand: [...hand('hearts'), card('2', 'clubs')], type: 'human' },
      { id: 'player_1', name: 'Luan', hand: [...hand('spades'), card('A', 'clubs')], type: 'bot' },
    ]),
  ],
];
import GameScreen from '@/app/game';

/** The screen over `table` resumed; `moved()` says whether the provider's table has changed since. */
const mount = async (table: GameState) => {
  const view = await renderAppHook(() => useGameTable().gameState, {
    offline: offlineSave(table),
    wrap: (probe) => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        {probe}
        <GameScreen />
      </SafeAreaProvider>
    ),
  });
  const opened = view.result.current;
  return { ...view, plays: () => (view.result.current?.lastMove?.seq ?? 0) - (opened?.lastMove?.seq ?? 0) };
};

describe('the first round, offline', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(TABLES)('%s: holds the bot holding the 3♠ until the deal has landed, then plays', async (_, table) => {
    const DEAL_ENDS = dealEndMs(table.players.map((p) => p.hand.length), Motion.duration.reveal);
    expect(DEAL_ENDS).toBeGreaterThan(OFFLINE_BOT_DELAY_MS + 200);
    const view = await mount(table);
    await steps(OFFLINE_BOT_DELAY_MS + 100);
    expect(view.plays()).toBe(0);

    await steps(DEAL_ENDS - OFFLINE_BOT_DELAY_MS + 100);
    expect(view.plays()).toBe(0);
    await steps(OFFLINE_BOT_DELAY_MS + 100);
    expect(view.plays()).toBe(1);
    await view.unmount();
  }, 30_000);
});
