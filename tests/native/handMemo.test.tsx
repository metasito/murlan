import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

import type { Card, Rank } from '@/lib/gameEngine';

// CardView asks lib/cosmetics which back to draw exactly once per render, and
// it asks before any branch, so counting that call counts renders of every card
// on the table. Prefixed `mock` because jest hoists the factory above it.
const mockCardRenders = { n: 0 };
jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBack: () => {
      mockCardRenders.n += 1;
      return actual.useCardBack();
    },
  };
});

// Imported after the mock so GameShared picks it up.
const { StraightHand } = require('@/components/GameShared') as typeof import('@/components/GameShared');

const RANKS: Rank[] = ['3', '4', '5', '6', '7'];

/**
 * A hand of fresh card objects. Every `game:state` is JSON off the socket, so
 * the client gets new objects for the same cards several times per move — the
 * case the memo comparators exist for.
 */
const hand = (): Card[] =>
  RANKS.map((rank) => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false }));

const noop = () => {};

const view = (cards: Card[], selectedIds: string[], onPress: (id: string) => void) => (
  <StraightHand
    cards={cards}
    selectedIds={selectedIds}
    onPress={onPress}
    disabled={false}
    availW={600}
  />
);

describe('the hand is not rebuilt by a render that changes nothing about it', () => {
  beforeEach(() => {
    mockCardRenders.n = 0;
  });

  it('re-rendering with a fresh array of the same cards commits no card render', async () => {
    const r = await render(view(hand(), [], noop));
    const afterMount = mockCardRenders.n;
    expect(afterMount).toBe(RANKS.length);

    await r.rerender(view(hand(), [], noop));
    expect(mockCardRenders.n).toBe(afterMount);
  });

  // The other half of the claim: the memo must not be swallowing real updates.
  it('selecting a card still re-renders it', async () => {
    const r = await render(view(hand(), [], noop));
    mockCardRenders.n = 0;

    await r.rerender(view(hand(), ['5_spades'], noop));
    expect(mockCardRenders.n).toBeGreaterThan(0);
  });

  // The reason GameTable stabilizes handleCardPress with useCallback: a fresh
  // arrow per render defeats every comparator below it.
  it('a new onPress reference rebuilds every card', async () => {
    const r = await render(view(hand(), [], noop));
    mockCardRenders.n = 0;

    await r.rerender(view(hand(), [], () => {}));
    expect(mockCardRenders.n).toBe(RANKS.length);
  });
});
