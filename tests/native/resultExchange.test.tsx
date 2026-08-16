// tests/native/resultExchange.test.tsx — the result screen's card exchange.
//
// Reaching this through a real game means winning a hand first, which is a coin
// flip, so the E2E suite can only ever assert on whichever branch it happened to
// land in. Here the state is handed straight to the component, so every branch
// is reachable and the interactive one — the only place a player chooses a card
// between hands — is checked exactly.
import { describe, it, expect, jest } from '@jest/globals';

// expo-haptics has no JS fallback under jest-expo, and every pick here fires
// one. Same local mock the haptics suite uses.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ResultExchangeOverlay } from '@/components/ResultExchangeOverlay';
import type { Card, GameState, Player, Rank, Suit } from '@/lib/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

const card = (rank: Rank, suit: Suit): Card => ({
  id: `${rank}_${suit}`,
  suit,
  rank,
  isJoker: false,
});

const joker = (kind: 'bw' | 'colored'): Card => ({
  id: kind === 'bw' ? 'joker_bw' : 'joker_colored',
  suit: null,
  rank: kind === 'bw' ? 'joker_bw' : 'joker_colored',
  isJoker: true,
});

const player = (id: string, type: 'human' | 'ai', hand: Card[]): Player => ({
  id,
  name: id,
  hand,
  type,
});

/**
 * A state parked in the exchange phase. `winnerType` decides which branch the
 * overlay takes — the whole reason for rendering it directly.
 */
function exchangeState(
  winnerType: 'human' | 'ai',
  winnerHand: Card[],
  bothJokersException = false
): GameState {
  return {
    players: [
      player('Ana', winnerType, winnerHand),
      player('Gent', 'ai', [card('K', 'hearts')]),
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: 'free_for_all',
    roundWinner: null,
    gameOver: true,
    rankings: ['Ana', 'Gent'],
    firstPlayMade: true,
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: card('3', 'spades'),
      bothJokersException,
    },
  };
}

// docs/RULES.md §10: only a 3 through a 10 may be given back, so the picker
// must offer those and never the Ace or the 2.
const WINNER_HAND = [
  card('4', 'clubs'),
  card('9', 'diamonds'),
  card('A', 'spades'),
  card('2', 'hearts'),
];

const overlay = (state: GameState, chooseExchangeCard: (id: string) => void = () => {}) =>
  withSafeArea(
    <ResultExchangeOverlay gameState={state} chooseExchangeCard={chooseExchangeCard} />
  );

describe('the result screen card exchange', () => {
  it('offers only the cards the rules allow to be given back', async () => {
    const view = await render(overlay(exchangeState('human', WINNER_HAND)));

    expect(view.queryAllByRole('radio')).toHaveLength(2);
    expect(view.queryByLabelText(/Asso/i)).toBeNull();
    await view.unmount();
  });

  it('will not confirm until a card is picked, and then returns the picked one', async () => {
    const chooseExchangeCard = jest.fn();
    const view = await render(overlay(exchangeState('human', WINNER_HAND), chooseExchangeCard));

    // Pressing with nothing selected must do nothing at all. This overlay is
    // the only way off the result screen, so a confirm that fired on an empty
    // selection would hand back `null` and strand the match.
    fireEvent.press(view.getByRole('button'));
    expect(chooseExchangeCard).not.toHaveBeenCalled();

    fireEvent.press(view.getAllByRole('radio')[0]);
    await waitFor(() => expect(view.getAllByRole('radio', { selected: true })).toHaveLength(1));

    fireEvent.press(view.getByRole('button'));
    await waitFor(() => expect(chooseExchangeCard).toHaveBeenCalledTimes(1));
    expect(chooseExchangeCard).toHaveBeenCalledWith('4_clubs');
    await view.unmount();
  });

  it('reports exactly one card as selected to a screen reader', async () => {
    const view = await render(overlay(exchangeState('human', WINNER_HAND)));
    expect(view.queryAllByRole('radio', { selected: true })).toHaveLength(0);

    fireEvent.press(view.getAllByRole('radio')[1]);

    await waitFor(() => {
      const selected = view.getAllByRole('radio', { selected: true });
      expect(selected).toHaveLength(1);
      expect(selected[0].props.accessibilityLabel).toBe('9 di Quadri');
    });
    await view.unmount();
  });

  it('never offers a choice when the winner is an AI seat', async () => {
    const view = await render(overlay(exchangeState('ai', WINNER_HAND)));
    expect(view.queryAllByRole('radio')).toHaveLength(0);
    await view.unmount();
  });

  // docs/RULES.md §10: the loser holding both Jokers skips the exchange, so
  // there is nothing to choose and only an acknowledgement to give.
  it('shows an acknowledgement, not a picker, on the two-joker exception', async () => {
    const view = await render(
      overlay(exchangeState('human', [joker('bw'), joker('colored')], true))
    );
    expect(view.queryAllByRole('radio')).toHaveLength(0);
    expect(view.getByRole('button')).toBeTruthy();
    await view.unmount();
  });

  // A winner holding nothing between a 3 and a 10 has no giveback under the
  // primary rule. Returning none there deadlocked the exchange behind an
  // undismissable overlay once already, so the engine falls back to the single
  // lowest card (lib/gameEngine.ts getValidGivebackCards) and the overlay has
  // to present that one choice rather than an empty row.
  it('still offers one card when the rules strictly allow none', async () => {
    const view = await render(
      overlay(exchangeState('human', [card('A', 'spades'), card('2', 'hearts')]))
    );
    const radios = view.getAllByRole('radio');
    expect(radios).toHaveLength(1);
    expect(radios[0].props.accessibilityLabel).toBe('Asso di Picche');
    await view.unmount();
  });
});
