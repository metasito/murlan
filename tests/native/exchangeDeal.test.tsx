// tests/native/exchangeDeal.test.tsx — an exchange manche opens with the deal, and the trade waits for it (#1416).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { dealEndMs } from '@/lib/game/dealTimeline';
import { LEG, choiceOpensAt } from '@/lib/game/exchangeTimeline';
import { emptyRankTally, type Card, type GameState, type Player, type Rank, type Suit } from '@/lib/game/gameEngine';
import { frames } from './helpers/exchangeLegs';
import { bootFeedback } from './helpers/feedback';

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });

const players = [
  seat('player_0', 'Ana', [card('5', 'hearts'), card('9', 'clubs'), card('K', 'diamonds'), card('A', 'spades')]),
  seat('player_1', 'Bea', [card('4', 'clubs')]),
  seat('player_2', 'Cesk', [card('6', 'hearts')]),
];
const COUNTS = players.map((p) => p.hand.length);

const base: GameState = {
  players,
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
const ended: GameState = { ...base, gameOver: true, rankings: ['player_0', 'player_2', 'player_1'] };
const exchange: GameState = {
  ...base,
  playedRanks: emptyRankTally(),
  exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: card('2', 'spades'), bothJokersException: false },
};

const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
    <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} />
  </SafeAreaProvider>
);
const backs = () => screen.queryAllByTestId('dealt-back');
const prompt = () => screen.queryByTestId('exchange-prompt');

describe('an exchange manche', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is dealt onto the standing table before its trade opens', async () => {
    const view = await render(table(ended));
    await frames(64);
    expect(backs()).toHaveLength(0);

    await view.rerender(table(exchange));
    let dealtUntil = -1;
    let receivedFrom = -1;
    await frames(dealEndMs(COUNTS, 0) + LEG.end, (t) => {
      if (backs().length > 0) dealtUntil = t;
      const leg = screen.queryByTestId('exchange-flier-to-winner', { includeHiddenElements: true });
      if (receivedFrom < 0 && leg && getAnimatedStyle(leg).opacity === 1) receivedFrom = t;
    });
    expect(dealtUntil).toBeGreaterThan(0);
    expect(receivedFrom).toBeGreaterThan(dealtUntil);
    expect(prompt()).toBeNull();

    await frames(choiceOpensAt(false));
    expect(prompt()).not.toBeNull();
    await view.unmount();
  });

  it('is not dealt again once a card has been played into it', async () => {
    const tally = emptyRankTally();
    tally[0] = 1;
    const view = await render(table({ ...base, playedRanks: tally }));
    await frames(32);
    expect(backs()).toHaveLength(0);
    await view.unmount();
  });
});
