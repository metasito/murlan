// tests/native/giocaFollowsShownTurn.test.tsx — Gioca follows the turn the table shows, which waits for the deal (#1624).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { dealEndMs } from '@/lib/timeline/dealTimeline';
import type { Card, GameState, Rank } from '@/lib/game/gameEngine';
import { Motion } from '@/lib/tokens';
import { steps } from './helpers/steps';
import { bootFeedback } from './helpers/feedback';

const RANKS: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const hand = (suit: 'spades' | 'hearts'): Card[] => RANKS.map((rank) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false }));

const OPENING: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: hand('spades'), type: 'human' },
    { id: 'player_1', name: 'Luan', hand: hand('hearts'), type: 'bot' },
  ],
  currentTurnIndex: 0,
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
};

const notYourTurn = () => String(screen.getByTestId('btn-gioca').props.accessibilityLabel).includes('it is not your turn');

describe('the viewer opening the first round', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is told it is not their turn by Gioca while the deal is in flight, and not once it has landed', async () => {
    const onDealing = jest.fn();
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } }}>
        <GameTable gameState={OPENING} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} onDealing={onDealing} />
      </SafeAreaProvider>
    );
    await steps(160);
    expect({ notYourTurn: notYourTurn(), dealing: onDealing.mock.calls.at(-1) }).toEqual({ notYourTurn: true, dealing: [true] });

    await steps(dealEndMs([13, 13], Motion.duration.reveal) + 200);
    expect({ notYourTurn: notYourTurn(), dealing: onDealing.mock.calls.at(-1) }).toEqual({ notYourTurn: false, dealing: [false] });
    await view.unmount();
  }, 20_000);
});
