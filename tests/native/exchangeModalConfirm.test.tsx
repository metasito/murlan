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
  // One modal, walked through the whole sequence, because that is what the
  // feature is: a state machine over a single mount. Splitting it across cases
  // would remount the modal per case, and a second mount renders nothing under
  // react-test-renderer once a state update has run in the first.
  //
  // Changing the pick before confirming needs two sequential presses on one
  // mount, which the renderer cannot re-render for — that case lives in
  // tests/e2e/exchangePickChange.spec.ts instead.
  it('holds the pick until confirmed, then gives exactly the last one chosen', async () => {
    const { view, onSelectCard } = await open();

    // The floor: a confirm control that fired unconditionally would satisfy
    // every assertion below, so it has to do nothing with no card chosen.
    await fireEvent.press(view.getByTestId('exchange-confirm'));
    expect(onSelectCard).not.toHaveBeenCalled();

    // The slot starts empty, so the card appears once — in the row of choices.
    expect(view.queryAllByLabelText(spoken(FIVE))).toHaveLength(1);

    // Choosing is not giving.
    await fireEvent.press(view.getByLabelText(spoken(FIVE)));
    expect(onSelectCard).not.toHaveBeenCalled();

    // ...and it fills the slot that was a "?": once in the row, once in the slot.
    expect(view.queryAllByLabelText(spoken(FIVE))).toHaveLength(2);

    // Only the confirm gives, and it gives the card that was chosen.
    await fireEvent.press(view.getByTestId('exchange-confirm'));
    expect(onSelectCard).toHaveBeenCalledTimes(1);
    expect(onSelectCard).toHaveBeenCalledWith(FIVE.id);
  });
});
