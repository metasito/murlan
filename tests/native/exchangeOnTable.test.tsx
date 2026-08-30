// tests/native/exchangeOnTable.test.tsx — the exchange happens on the table.
//
// The old dialog rendered `getValidGivebackCards`' output and nothing else, so
// the winner chose what to give away without being able to see what they were
// keeping. The whole hand is on screen now, which makes two things load-bearing
// that a filtered row got for free: an ungiveable card has to *say* it is
// ungiveable rather than simply be absent, and the confirm has to be the table's
// own key rather than a second one floating over it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
import { getValidGivebackCards } from '@/lib/gameEngine';
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

const WINNER = 'Ana';
const LOSER = 'Bea';
const BYSTANDER = 'Cesk';

/** A 2 — outside the 3–10 range, so it can only be the card the loser gave. */
const FROM_LOSER = card('2', 'spades');
const FIVE = card('5', 'hearts');
const NINE = card('9', 'clubs');
const KING = card('K', 'diamonds');
const ACE = card('A', 'spades');
/** Two giveable and two not, so "all of them" and "the legal ones" differ. */
const WINNER_HAND = [FIVE, NINE, KING, ACE];

const seat = (id: string, name: string, hand: Card[]): Player => ({
  id,
  name,
  hand,
  type: 'human',
});

const state = (): GameState => ({
  players: [
    seat('player_0', WINNER, WINNER_HAND),
    seat('player_1', LOSER, [card('4', 'clubs')]),
    seat('player_2', BYSTANDER, [card('6', 'hearts')]),
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
    active: true,
    winnerIdx: 0,
    loserIdx: 1,
    cardFromLoser: FROM_LOSER,
    bothJokersException: false,
  },
});

const noop = () => {};

const table = (opts: { viewerSeat: number; onExchangeGive?: (id: string) => void }) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state()}
      viewerSeat={opts.viewerSeat}
      selectedIds={[]}
      onSelectCard={noop}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={opts.onExchangeGive ?? noop}
    />
  </SafeAreaProvider>
);

const spoken = (c: Card) => cardSpokenName(c, t);
const handCard = (c: Card) => screen.getAllByLabelText(spoken(c))[0];
const press = async (node: Parameters<typeof fireEvent.press>[0]) => {
  await act(async () => {
    fireEvent.press(node);
  });
};

describe('the winner picks from their own hand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows every card the winner holds, not only the ones they may give', async () => {
    const r = await render(table({ viewerSeat: 0 }));

    // The complaint this ticket answers: you cannot judge what is least needed
    // without seeing what you are keeping.
    for (const c of WINNER_HAND) {
      expect(screen.queryAllByLabelText(spoken(c)).length).toBeGreaterThan(0);
    }

    await r.unmount();
  });

  it('lets the giveable cards be pressed and refuses the rest by name', async () => {
    const r = await render(table({ viewerSeat: 0 }));
    const giveable = new Set(getValidGivebackCards(WINNER_HAND, FROM_LOSER.id).map((c) => c.id));

    // The engine's own answer, not a rank range restated here: the fan's
    // highlighting and `processExchangeChoice`'s validation must agree, and
    // they can only be made to agree by asking the same function.
    expect([...giveable].sort()).toEqual([FIVE.id, NINE.id].sort());

    for (const c of WINNER_HAND) {
      const node = handCard(c);
      if (giveable.has(c.id)) {
        expect(node.props.accessibilityState?.disabled).toBeFalsy();
      } else {
        expect(node.props.accessibilityState?.disabled).toBe(true);
        expect(node.props.accessibilityHint).toBe(t('exchange.cardA11yNotGiveable'));
      }
    }

    await r.unmount();
  });

  it('holds the pick until GIOCA is pressed, and gives the last card chosen', async () => {
    const onExchangeGive = jest.fn<(id: string) => void>();
    const r = await render(table({ viewerSeat: 0, onExchangeGive }));

    // The floor: a confirm that fired unconditionally would satisfy everything
    // below, so with nothing picked it has to do nothing.
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).not.toHaveBeenCalled();

    await press(handCard(FIVE));
    expect(onExchangeGive).not.toHaveBeenCalled();

    // A second tap replaces rather than adds — an exchange gives one card.
    await press(handCard(NINE));
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).toHaveBeenCalledTimes(1);
    expect(onExchangeGive).toHaveBeenCalledWith(NINE.id);

    await r.unmount();
  });

  it('renames GIOCA for the exchange, so the key does not say PLAY', async () => {
    const r = await render(table({ viewerSeat: 0 }));
    const name = () => screen.getByTestId('btn-gioca').props.accessibilityLabel;

    expect(name()).toBe(t('exchange.confirmA11yWaiting', { name: LOSER }));
    expect(name()).not.toBe(t('gameTable.playA11yValid'));

    await press(handCard(FIVE));
    expect(name()).toBe(
      t('exchange.confirmA11yReady', { card: spoken(FIVE), name: LOSER })
    );

    await r.unmount();
  });

  it('puts the card the loser gave on the felt exactly once', async () => {
    const r = await render(table({ viewerSeat: 0 }));

    // Twice would mean the prompt and the hand are both drawing it — the card
    // is the loser's, and it is not in the winner's hand yet.
    expect(screen.queryAllByLabelText(spoken(FROM_LOSER))).toHaveLength(0);
    expect(screen.getByTestId('exchange-prompt')).toBeTruthy();

    await r.unmount();
  });
});

describe('the other seats can read the exchange from the table', () => {
  // #532's decision replaced the mocked options for the flight with a
  // requirement in the owner's words: "as clear as possible for all the players
  // involved not only the 2 involved in the exchange". A prompt only the winner
  // can see fails that before any card moves.
  it('tells the loser who is choosing for them', async () => {
    const r = await render(table({ viewerSeat: 1 }));

    expect(screen.getByTestId('exchange-prompt')).toBeTruthy();
    expect(
      screen.queryAllByText(t('exchange.waitingForYou', { winner: WINNER }))
    ).toHaveLength(1);

    await r.unmount();
  });

  it('tells a seat outside the exchange who is choosing for whom', async () => {
    const r = await render(table({ viewerSeat: 2 }));

    expect(
      screen.queryAllByText(t('exchange.watching', { winner: WINNER, loser: LOSER }))
    ).toHaveLength(1);
    // …and does not offer them a confirm for somebody else's decision.
    expect(screen.getByTestId('btn-gioca').props.accessibilityLabel).not.toBe(
      t('exchange.confirmA11yWaiting', { name: LOSER })
    );

    await r.unmount();
  });
});
