// tests/native/ceremonyHoldsTheCard.test.tsx — the hand does not hold the
// traded card while the flight carrying it is still on screen.
//
// The exchange ends its phase, hands the card over and raises the announcement
// in one tick, so the state behind the ceremony has already moved on. Left
// alone, the two cards are drawn crossing the felt over a hand that finished
// changing before they set off — a decorative copy rather than a delivery, and
// the arrival #650 is built on has nowhere to arrive.
//
// The `arrivingCard` unit tests say which card each seat is owed; only a
// rendered table says whether the hand actually leaves the place for it.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
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
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  rank,
  suit,
  isJoker: false,
});

const WINNER_SEAT = 0;
const LOSER_SEAT = 1;

/** Taken off the loser, on its way to the winner. */
const FROM_LOSER = card('2', 'spades');
/** Chosen by the winner, on its way to the loser. */
const TO_LOSER = card('5', 'hearts');

const KEPT_BY_WINNER = [card('9', 'clubs'), card('K', 'diamonds')];
const KEPT_BY_LOSER = [card('4', 'clubs')];

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

/**
 * The table one tick after the choice: the phase is closed, the winner has
 * given `TO_LOSER` away and holds `FROM_LOSER`, and the loser the reverse.
 * Both cards are still in the air.
 */
const settled = (): GameState => ({
  players: [
    seat('player_0', 'Ana', [...KEPT_BY_WINNER, FROM_LOSER]),
    seat('player_1', 'Bea', [...KEPT_BY_LOSER, TO_LOSER]),
    seat('player_2', 'Cesk', [card('6', 'hearts')]),
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  exchangePhase: {
    active: false,
    winnerIdx: WINNER_SEAT,
    loserIdx: LOSER_SEAT,
    cardFromLoser: FROM_LOSER,
    cardToLoser: TO_LOSER,
    bothJokersException: false,
  },
});

const announce = (bothJokersException = false) => ({
  winnerName: 'Ana',
  loserName: 'Bea',
  winnerIdx: WINNER_SEAT,
  loserIdx: LOSER_SEAT,
  bothJokersException,
  cardGiven: TO_LOSER,
  cardReceived: FROM_LOSER,
});

const noop = () => {};

const table = (opts: {
  viewerSeat: number;
  visible: boolean;
  bothJokersException?: boolean;
  spectating?: boolean;
}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={settled()}
      viewerSeat={opts.viewerSeat}
      spectating={opts.spectating}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
      exchangeAnnouncement={{
        visible: opts.visible,
        data: announce(opts.bothJokersException),
        onDismiss: noop,
      }}
    />
  </SafeAreaProvider>
);

/**
 * Only the hand names its cards. The flying card is hidden from the
 * accessibility tree, and the ceremony speaks through one live region rather
 * than through nodes carrying card names — so a node with this name is the fan.
 */
const named = (c: Card) => screen.queryAllByLabelText(cardSpokenName(c, t)).length;

describe('the hand leaves a place for the card still in the air', () => {
  it('does not hold the winner\'s incoming card while the ceremony runs', async () => {
    const r = await render(table({ viewerSeat: WINNER_SEAT, visible: true }));

    // The floor: the cards it kept are on screen, so an empty hand cannot pass
    // this by holding nothing at all.
    for (const c of KEPT_BY_WINNER) {
      expect(named(c)).toBeGreaterThan(0);
    }
    // What is drawn crossing the felt is not also sitting in the fan.
    expect(named(FROM_LOSER)).toBe(0);

    await r.unmount();
  });

  it('does not hold the loser\'s incoming card while the ceremony runs', async () => {
    const r = await render(table({ viewerSeat: LOSER_SEAT, visible: true }));

    for (const c of KEPT_BY_LOSER) {
      expect(named(c)).toBeGreaterThan(0);
    }
    expect(named(TO_LOSER)).toBe(0);

    await r.unmount();
  });

  it('gives the card to the hand once the ceremony is over', async () => {
    const r = await render(table({ viewerSeat: WINNER_SEAT, visible: false }));

    // The card the ceremony just delivered.
    expect(named(FROM_LOSER)).toBeGreaterThan(0);

    await r.unmount();
  });

  // Nothing flies when both Jokers cancelled the exchange, so a hand that held
  // a card back would hold it back for the length of a notice with no delivery.
  it('holds nothing back when both Jokers cancelled the exchange', async () => {
    const r = await render(
      table({ viewerSeat: WINNER_SEAT, visible: true, bothJokersException: true })
    );

    expect(named(FROM_LOSER)).toBeGreaterThan(0);

    await r.unmount();
  });
});
