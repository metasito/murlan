// tests/native/exchangeModalConfirm.test.tsx — the pick is uncommitted until
// confirmed.
//
// The preview slot in the loser's row can only show the card the winner is
// about to give if that card exists somewhere before it is given. Tapping used
// to be the give, so there was no such moment.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ExchangeModal } from '@/components/ExchangeModal';
import type { Card, ExchangePhase } from '@/lib/gameEngine';
import { cardSpokenName } from '@/lib/cardNames';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

/** A 2 — outside the 3–10 giveback range, so it can only be the loser's card. */
const FROM_LOSER: Card = { id: '2_spades', suit: 'spades', rank: '2', isJoker: false };
const FIVE: Card = { id: '5_hearts', suit: 'hearts', rank: '5', isJoker: false };
const NINE: Card = { id: '9_clubs', suit: 'clubs', rank: '9', isJoker: false };

const PHASE: ExchangePhase = {
  active: true,
  winnerIdx: 0,
  loserIdx: 1,
  cardFromLoser: FROM_LOSER,
  bothJokersException: false,
};

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const spoken = (card: Card) => cardSpokenName(card, t as never);

async function open() {
  const onSelectCard = jest.fn();
  const view = await render(
    <ExchangeModal
      phase={PHASE}
      winnerHand={[FIVE, NINE]}
      loserName="Bea"
      winnerName="Ana"
      onSelectCard={onSelectCard}
    />
  );
  await act(async () => {});
  return { view, onSelectCard };
}

describe('the exchange pick is uncommitted until confirmed', () => {
  it('does not give the card on the tap that chooses it', async () => {
    const { view, onSelectCard } = await open();

    fireEvent.press(view.getByLabelText(spoken(FIVE)));

    expect(onSelectCard).not.toHaveBeenCalled();
  });

  it('gives the chosen card once confirmed', async () => {
    const { view, onSelectCard } = await open();

    fireEvent.press(view.getByLabelText(spoken(NINE)));
    fireEvent.press(view.getByTestId('exchange-confirm'));

    expect(onSelectCard).toHaveBeenCalledTimes(1);
    expect(onSelectCard).toHaveBeenCalledWith(NINE.id);
  });

  it('gives the last card chosen, not the first', async () => {
    const { view, onSelectCard } = await open();

    fireEvent.press(view.getByLabelText(spoken(FIVE)));
    fireEvent.press(view.getByLabelText(spoken(NINE)));
    fireEvent.press(view.getByTestId('exchange-confirm'));

    expect(onSelectCard).toHaveBeenCalledWith(NINE.id);
  });

  // The floor: without this, a confirm control that fires unconditionally
  // would satisfy every assertion above.
  it('gives nothing when confirmed with no card chosen', async () => {
    const { view, onSelectCard } = await open();

    fireEvent.press(view.getByTestId('exchange-confirm'));

    expect(onSelectCard).not.toHaveBeenCalled();
  });

  it('fills the empty slot with the chosen card', async () => {
    const { view } = await open();
    const help = view.queryAllByLabelText(spoken(FIVE));
    expect(help).toHaveLength(1);

    fireEvent.press(view.getByLabelText(spoken(FIVE)));

    // Once in the row of choices, once in the slot that was a "?".
    expect(view.queryAllByLabelText(spoken(FIVE))).toHaveLength(2);
  });
});
