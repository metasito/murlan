// tests/native/exchangeOnTable.test.tsx — the exchange happens on the table.
//
// The old dialog rendered `getValidGivebackCards`' output and nothing else, so
// the winner chose what to give away without being able to see what they were
// keeping. The whole hand is on screen now, which makes two things load-bearing
// that a filtered row got for free: an ungiveable card has to *say* it is
// ungiveable rather than simply be absent, and the confirm has to be the table's
// own key rather than a second one floating over it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { cardSpokenName } from '@/lib/cardNames';
import { t } from '@/lib/i18n';
import { choiceOpensAt } from '@/lib/game/exchangeTimeline';
import { getValidGivebackCards } from '@/lib/game/gameEngine';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/game/gameEngine';
import { activate } from './tapHelpers';

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

const OPENS = choiceOpensAt(false);
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

const state = (exchange = true): GameState => ({
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
  exchangePhase: exchange
    ? { active: true, winnerIdx: 0, loserIdx: 1, cardFromLoser: FROM_LOSER, bothJokersException: false }
    : undefined,
});

const noop = () => {};

const table = (opts: { viewerSeat: number; onExchangeGive?: (id: string) => void; onExchangeReady?: () => void; exchange?: boolean }) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={state(opts.exchange)}
      onExchangeReady={opts.onExchangeReady}
      viewerSeat={opts.viewerSeat}
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
const step = async (ms: number) => {
  for (let at = 0; at < ms; at += 16) await act(async () => jest.advanceTimersByTime(16));
};
const open = () => step(OPENS + 32);

describe('the winner picks from their own hand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('takes no pick and gives nothing before the choice opens', async () => {
    const onExchangeGive = jest.fn<(id: string) => void>();
    const r = await render(table({ viewerSeat: 0, onExchangeGive }));
    await step(OPENS - 64);
    await activate(handCard(FIVE));
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).not.toHaveBeenCalled();

    await step(128);
    await activate(handCard(FIVE));
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).toHaveBeenCalledWith(FIVE.id);
    await r.unmount();
  });

  it("opens a later manche's choice on its own receive, though the pairing and the card repeat", async () => {
    const onExchangeReady = jest.fn();
    const r = await render(table({ viewerSeat: 0, onExchangeReady }));
    await open();
    expect(screen.getByTestId('exchange-prompt')).toBeTruthy();
    await act(async () => r.rerender(table({ viewerSeat: 0, onExchangeReady, exchange: false })));
    await act(async () => r.rerender(table({ viewerSeat: 0, onExchangeReady })));
    expect(screen.queryByTestId('exchange-prompt')).toBeNull();

    await step(OPENS - 64);
    expect(screen.queryByTestId('exchange-prompt')).toBeNull();
    expect(onExchangeReady).toHaveBeenCalledTimes(1);
    await step(128);
    expect(onExchangeReady).toHaveBeenCalledTimes(2);
    await r.unmount();
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
    await open();
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
    await open();

    // The floor: a confirm that fired unconditionally would satisfy everything
    // below, so with nothing picked it has to do nothing.
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).not.toHaveBeenCalled();

    await activate(handCard(FIVE));
    expect(onExchangeGive).not.toHaveBeenCalled();

    // A second tap replaces rather than adds — an exchange gives one card.
    await activate(handCard(NINE));
    await press(screen.getByTestId('btn-gioca'));
    expect(onExchangeGive).toHaveBeenCalledTimes(1);
    expect(onExchangeGive).toHaveBeenCalledWith(NINE.id);

    await r.unmount();
  });

  it('renames GIOCA for the exchange, so the key does not say PLAY', async () => {
    const r = await render(table({ viewerSeat: 0 }));
    await open();
    const name = () => screen.getByTestId('btn-gioca').props.accessibilityLabel;

    expect(name()).toBe(t('exchange.confirmA11yWaiting', { name: LOSER }));
    expect(name()).not.toBe(t('gameTable.playA11yValid'));

    await activate(handCard(FIVE));
    expect(name()).toBe(
      t('exchange.confirmA11yReady', { card: spoken(FIVE), name: LOSER })
    );

    await r.unmount();
  });

  it('puts the card the loser gave on the felt exactly once', async () => {
    const r = await render(table({ viewerSeat: 0 }));

    // Twice would mean the flier and the hand are both drawing it.
    expect(screen.queryAllByLabelText(spoken(FROM_LOSER))).toHaveLength(0);
    expect(
      screen.getAllByTestId('exchange-flier-to-winner', { includeHiddenElements: true })
    ).toHaveLength(1);

    await r.unmount();
  });
});

describe('the choice opens once the received card has landed and been read', () => {
  it.each([
    ['the winner', 0, t('exchange.chipGive', { name: LOSER })],
    ['the loser', 1, t('exchange.waitingForYou', { winner: WINNER })],
    ['a seat outside the exchange', 2, t('exchange.watching', { winner: WINNER, loser: LOSER })],
  ])('names the choice to %s only then', async (_who, viewerSeat, line) => {
    jest.useFakeTimers();
    const r = await render(table({ viewerSeat }));
    await step(OPENS - 64);
    expect(screen.queryByTestId('exchange-prompt')).toBeNull();
    expect(screen.queryAllByText(line, { includeHiddenElements: true })).toHaveLength(0);
    await step(128);
    expect(within(screen.getByTestId('exchange-prompt')).queryAllByText(line, { includeHiddenElements: true }).length).toBeGreaterThan(0);
    await r.unmount();
    jest.useRealTimers();
  });
});

describe('the other seats can read the exchange from the table', () => {
  // #532's decision replaced the mocked options for the flight with a
  // requirement in the owner's words: "as clear as possible for all the players
  // involved not only the 2 involved in the exchange". A prompt only the winner
  // can see fails that before any card moves.
  it('does not offer a seat outside the exchange a confirm for somebody else\'s decision', async () => {
    const r = await render(table({ viewerSeat: 2 }));

    expect(screen.getByTestId('btn-gioca').props.accessibilityLabel).not.toBe(
      t('exchange.confirmA11yWaiting', { name: LOSER })
    );

    await r.unmount();
  });

  // #602: the card the loser gave is a public move — GAME-RULES.md §10.1 makes it
  // compulsory, so no seat is being told a secret — and watching a trade you
  // cannot see is the defect the ticket names. The winner's own case is
  // covered above; these are the two seats that used to get nothing.
  it.each([
    ['the loser', 1],
    ['a seat outside the exchange', 2],
  ])('draws the card on the felt for %s', async (_who, viewerSeat) => {
    const r = await render(table({ viewerSeat }));

    expect(
      screen.getAllByTestId('exchange-flier-to-winner', { includeHiddenElements: true })
    ).toHaveLength(1);

    await r.unmount();
  });
});
