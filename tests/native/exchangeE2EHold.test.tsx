// tests/native/exchangeE2EHold.test.tsx — #915: `GameTable` forwards a
// `holdMsOverride` through to `<ExchangeLegs>`'s own dismiss clock,
// rather than the prop being accepted and dropped. A regex over the source
// cannot see whether a forwarding prop is wired to anything real — deleting
// `holdMsOverride={exchangeAnnouncement.holdMsOverride}` from `GameTable.tsx`
// would still read fine as text, so this drives the actual timer instead.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { LEG } from '@/lib/game/exchangeTimeline';
import { Motion } from '@/lib/tokens';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });

const CARD_GIVEN = card('5', 'hearts');
const CARD_RECEIVED = card('2', 'spades');

/** A settled table — the overlay's own render does not need an open exchangePhase. */
const state = (): GameState => ({
  players: [seat('player_0', 'Ana', []), seat('player_1', 'Bea', [])],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};

const tableWith = (holdMsOverride: number | undefined, onDismiss: () => void) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state()}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      exchangeAnnouncement={{
        visible: true,
        data: {
          winnerName: 'Ana',
          loserName: 'Bea',
          winnerIdx: 0,
          loserIdx: 1,
          bothJokersException: false,
          cardGiven: CARD_GIVEN,
          cardReceived: CARD_RECEIVED,
        },
        onDismiss,
        holdMsOverride,
      }}
    />
  </SafeAreaProvider>
);

/** Mounted with both cards known, both legs fly: the receive and its read, then the give and its read. */
const REAL_MS = Motion.exchange.beat + 2 * (LEG.end + Motion.exchange.read);
const FRAME_MS = 16;
/** Frame by frame, so the legs' clock reports its landing before the reading hold is set. */
const frames = async (ms: number) => {
  for (let t = 0; t < ms; t += FRAME_MS) await act(async () => jest.advanceTimersByTime(Math.min(FRAME_MS, ms - t)));
};

describe('the offline table forwards holdMsOverride to the overlay it renders', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('with no override, dismisses at the real duration, within the frames its clock is sampled on', async () => {
    const onDismiss = jest.fn();
    const r = await render(tableWith(undefined, onDismiss));
    expect(screen.getByTestId('exchange-announce')).toBeTruthy();

    await frames(REAL_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    await frames(3 * FRAME_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await r.unmount();
  });

  it('with an override, stays open past the real duration and dismisses at the override instead', async () => {
    const onDismiss = jest.fn();
    const HOLD = REAL_MS + 5000;
    const r = await render(tableWith(HOLD, onDismiss));

    await act(async () => jest.advanceTimersByTime(REAL_MS + 1000));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('exchange-announce')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(HOLD - REAL_MS - 1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await r.unmount();
  });
});
