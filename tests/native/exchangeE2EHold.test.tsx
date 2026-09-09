// tests/native/exchangeE2EHold.test.tsx — #915: `GameTable` forwards a
// `holdMsOverride` through to `<ExchangeAnnouncement>`'s own dismiss clock,
// rather than the prop being accepted and dropped. A regex over the source
// cannot see whether a forwarding prop is wired to anything real — deleting
// `holdMsOverride={exchangeAnnouncement.holdMsOverride}` from `GameTable.tsx`
// would still read fine as text, so this drives the actual timer instead.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/lib/sounds', () => ({
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  unloadSounds: jest.fn(() => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import { GameTable } from '@/components/GameTable';
import { exchangeAnnounceMs } from '@/lib/exchangeCeremony';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

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
      selectedIds={[]}
      onSelectCard={noop}
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

const REAL_MS = exchangeAnnounceMs(false);

describe('the offline table forwards holdMsOverride to the overlay it renders', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('with no override, dismisses at the real duration', async () => {
    const onDismiss = jest.fn();
    const r = await render(tableWith(undefined, onDismiss));
    expect(screen.getByTestId('exchange-announce')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(REAL_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(1));
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
