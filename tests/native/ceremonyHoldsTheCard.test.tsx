// tests/native/ceremonyHoldsTheCard.test.tsx — the hand does not hold the
// traded card while the flight carrying it is still on screen.
//
// `arrivingCard` (tests/gameTableModel.test.ts) says which card each seat is
// owed. Only a rendered table says whether the fan actually leaves the place
// for it, which is what #650 lands into.
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
const settled = (winnerHand: Card[] = [...KEPT_BY_WINNER, FROM_LOSER]): GameState => ({
  players: [
    seat('player_0', 'Ana', winnerHand),
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

/**
 * The table while the winner is still choosing: the phase is open, the engine
 * has already handed them `FROM_LOSER`, and `ExchangePrompt` is drawing that
 * same card on the felt.
 */
const prompting = (): GameState => {
  const state = settled();
  state.exchangePhase = { ...state.exchangePhase!, active: true, cardToLoser: undefined };
  state.players[LOSER_SEAT] = seat('player_1', 'Bea', KEPT_BY_LOSER);
  return state;
};

const table = (opts: {
  viewerSeat: number;
  visible: boolean;
  bothJokersException?: boolean;
  spectating?: boolean;
  /** Build the winner's hand without the traded card, as a size control. */
  shortOne?: boolean;
  /** The phase still open, rather than one tick after the choice. */
  choosing?: boolean;
}) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={
        opts.choosing ? prompting() : settled(opts.shortOne ? KEPT_BY_WINNER : undefined)
      }
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

  // The owner's report, and the older half of the defect: the engine hands the
  // winner the loser's card as the phase opens, so it sat in the fan for the
  // whole prompt while the prompt drew it on the felt.
  it('does not hold the card the prompt is drawing on the felt', async () => {
    const r = await render(table({ viewerSeat: WINNER_SEAT, visible: false, choosing: true }));

    // The felt's copy is there, and it is the only one. Hidden from the
    // accessibility tree — the prompt speaks it through one live region — so it
    // is only reachable by asking for hidden elements.
    expect(
      screen.getByTestId('exchange-received-card', { includeHiddenElements: true })
    ).toBeTruthy();
    for (const c of KEPT_BY_WINNER) {
      expect(named(c)).toBeGreaterThan(0);
    }
    expect(named(FROM_LOSER)).toBe(0);

    await r.unmount();
  });

  it('gives the card to the hand once the ceremony is over', async () => {
    const r = await render(table({ viewerSeat: WINNER_SEAT, visible: false }));

    // The card the ceremony just delivered.
    expect(named(FROM_LOSER)).toBeGreaterThan(0);

    await r.unmount();
  });

  it('holds nothing back when both Jokers cancelled the exchange', async () => {
    const r = await render(
      table({ viewerSeat: WINNER_SEAT, visible: true, bothJokersException: true })
    );

    expect(named(FROM_LOSER)).toBeGreaterThan(0);

    await r.unmount();
  });

  /**
   * The row's own width, which `computeHandLayout` solves from the number of
   * slots. It is the one number that says whether the row stepped for the hand
   * *including* the card still in the air.
   */
  const rowWidth = () => {
    const style = screen.getByTestId('hand-row').props.style as
      | { width?: number }[]
      | { width?: number };
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    const { width } = flat as { width?: number };
    // Two undefineds compare equal, and so do two rows clamped to `availW`.
    // Either would pass the comparison below while measuring nothing.
    expect(typeof width).toBe('number');
    return width;
  };

  // Option A's whole thesis: the eye is told *where* before it is told *what*.
  // A row still stepped for the cards it draws would close over the slot and
  // the card would arrive on top of a fan that never moved.
  it('steps the row for the card in the air, not for the cards it draws', async () => {
    const during = await render(table({ viewerSeat: WINNER_SEAT, visible: true }));
    const holdingASlot = rowWidth();
    await during.unmount();

    const after = await render(table({ viewerSeat: WINNER_SEAT, visible: false }));
    const withTheCard = rowWidth();
    await after.unmount();

    // The floor: at this size the row's width does track the count, so the
    // equality above is a row that stepped for the missing card rather than a
    // number that never moves.
    const never = await render(table({ viewerSeat: WINNER_SEAT, visible: false, shortOne: true }));
    const twoCards = rowWidth();
    await never.unmount();

    expect(twoCards).toBeLessThan(withTheCard as number);
    expect(holdingASlot).toBe(withTheCard);
  });

  // A spectated hand is synthetic — `hidden-N` ids standing in for cards the
  // watcher may not be shown — so there is nothing to hold back and no id that
  // could match the one arriving. The claim is that the ceremony changes
  // nothing, which is the same count either side of it rather than a number
  // written down here.
  it('holds nothing back from a spectator watching the winner\'s seat', async () => {
    const during = await render(
      table({ viewerSeat: WINNER_SEAT, visible: true, spectating: true })
    );
    const backsDuring = screen.getAllByTestId('card-box-back').length;
    await during.unmount();

    const after = await render(
      table({ viewerSeat: WINNER_SEAT, visible: false, spectating: true })
    );
    expect(screen.getAllByTestId('card-box-back').length).toBe(backsDuring);
    await after.unmount();
  });
});
