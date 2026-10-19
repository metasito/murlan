// tests/native/exchangeKeyHolds.test.tsx — one exchange keeps one ceremony whether or not the
// announcement that takes over from the phase knows the card received (#1625).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockMounts = { n: 0 };
jest.mock('@/components/table/ExchangeLegs', () => {
  const actual = jest.requireActual('@/components/table/ExchangeLegs') as typeof import('@/components/table/ExchangeLegs');
  const { useEffect, createElement } = jest.requireActual('react') as typeof import('react');
  return {
    ...actual,
    ExchangeLegs: (props: Parameters<typeof actual.ExchangeLegs>[0]) => {
      useEffect(() => {
        mockMounts.n++;
      }, []);
      return createElement(actual.ExchangeLegs, props);
    },
  };
});

import { GameTable } from '@/components/GameTable';
import { bootFeedback, settle, startsOf } from './helpers/feedback';
import { choiceOpensAt } from '@/lib/timeline/exchangeTimeline';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });
const FROM_LOSER = card('2', 'spades');
const TO_LOSER = card('5', 'hearts');

const state = (open: boolean): GameState => ({
  players: [
    seat('player_0', 'Ana', [card('9', 'clubs'), card('K', 'diamonds'), FROM_LOSER]),
    seat('player_1', 'Bea', open ? [card('4', 'clubs')] : [card('4', 'clubs'), TO_LOSER]),
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
  exchangePhase: {
    active: open,
    winnerIdx: 0,
    loserIdx: 1,
    cardFromLoser: FROM_LOSER,
    cardToLoser: open ? undefined : TO_LOSER,
    twoJokerException: false,
  },
});

const noop = () => {};
const onReady = jest.fn();

const table = (open: boolean) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state(open)}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      onExchangeReady={onReady}
      exchangeAnnouncement={{
        visible: !open,
        data: { winnerName: 'Ana', loserName: 'Bea', winnerIdx: 0, loserIdx: 1, twoJokerException: false, cardGiven: TO_LOSER, cardReceived: undefined },
        onDismiss: noop,
      }}
    />
  </SafeAreaProvider>
);

const cues = () => startsOf('exchange');
const frames = async (ms: number) => {
  for (let at = 0; at < ms; at += 16) await settle(16);
};

describe('an announcement taking over from the open phase', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    mockMounts.n = 0;
    onReady.mockClear();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the ceremony mounted, cued once and ready once when it does not know the card received', async () => {
    const view = await render(table(true));
    await frames(choiceOpensAt(false) + 160);
    expect(mockMounts.n).toBe(1);
    expect(cues()).toEqual([expect.any(Number)]);
    expect(onReady).toHaveBeenCalledTimes(1);
    const [received] = cues();

    await act(async () => view.rerender(table(false)));
    await frames(choiceOpensAt(false) + 160);
    expect(mockMounts.n).toBe(1);
    // One per leg: the receive's, then the give's once the choice lands.
    expect(cues()).toEqual([received, expect.any(Number)]);
    expect(cues()[1]).toBeGreaterThan(received!);
    expect(onReady).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
