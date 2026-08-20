// tests/native/exchangeModalDirections.test.tsx — the modal has two rows and an
// exchange has two legs, so each row must state a different one.
//
// Both rows used to describe the card the loser gave: the winner receiving it,
// and the loser giving it, the second marked unknown with a "?". That left the
// half that genuinely is unknown — the card the winner is about to hand back —
// with no row at all, while the known half was stated twice.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ExchangeModal } from '@/components/ExchangeModal';
import type { Card, ExchangePhase } from '@/lib/gameEngine';
import { cardSpokenName } from '@/lib/cardNames';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

const WINNER = 'Ana';
const LOSER = 'Bea';

/** A 2 — outside the 3–10 giveback range, so it can only be the loser's card. */
const FROM_LOSER: Card = { id: '2_spades', suit: 'spades', rank: '2', isJoker: false };
const WINNER_HAND: Card[] = [
  { id: '5_hearts', suit: 'hearts', rank: '5', isJoker: false },
  { id: '9_clubs', suit: 'clubs', rank: '9', isJoker: false },
];

const PHASE: ExchangePhase = {
  active: true,
  winnerIdx: 0,
  loserIdx: 1,
  cardFromLoser: FROM_LOSER,
  bothJokersException: false,
};

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

async function open() {
  const view = await render(
    <ExchangeModal
      phase={PHASE}
      winnerHand={WINNER_HAND}
      loserName={LOSER}
      winnerName={WINNER}
      onSelectCard={() => {}}
    />
  );
  await act(async () => {});
  return view;
}

describe('the exchange modal states both legs', () => {
  it('tags the two rows with different directions', async () => {
    const view = await open();
    const winnerTag = t('exchangeModal.receives');
    const loserTag = t('exchangeModal.willReceive');

    expect(winnerTag).not.toBe(loserTag);
    expect(view.queryAllByText(winnerTag)).toHaveLength(1);
    expect(view.queryAllByText(loserTag)).toHaveLength(1);
  });

  it('shows the card the loser gave exactly once', async () => {
    const view = await open();
    const spoken = cardSpokenName(FROM_LOSER, t as never);

    expect(view.queryAllByLabelText(spoken)).toHaveLength(1);
  });

  it('offers the winner a card to pick, so the second row has something to fill it', async () => {
    const view = await open();

    for (const card of WINNER_HAND) {
      expect(view.queryAllByLabelText(cardSpokenName(card, t as never))).toHaveLength(1);
    }
  });
});
