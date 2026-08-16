import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CardView } from '@/components/CardView';
import NotificationBanner from '@/components/NotificationBanner';
import type { Card, Rank, Suit } from '@/lib/gameEngine';

// react-native-web shims Reanimated onto CSS transitions, so on web a worklet
// never actually runs. Here the components mount under React Native's own
// renderer with the worklets babel plugin applied, which is what lets these
// renders catch a UI-thread-only failure.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

const card = (rank: Rank, suit: Suit | null): Card => ({
  id: `${rank}-${suit ?? 'joker'}`,
  suit,
  rank,
  isJoker: rank.startsWith('joker'),
});

describe('CardView renders every card natively', () => {
  const every: Card[] = [
    ...SUITS.flatMap((s) => RANKS.map((r) => card(r, s))),
    card('joker_bw', null),
    card('joker_colored', null),
  ];

  it.each(every.map((c) => [c.id, c] as const))('%s mounts', async (_id, c) => {
    const view = await render(withSafeArea(<CardView card={c} />));
    expect(view.toJSON()).toBeTruthy();
    await view.unmount();
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('mounts selected=%s faceDown=%s', async (selected, faceDown) => {
    const view = await render(
      withSafeArea(
        <CardView
          card={card('A', 'spades')}
          selected={selected}
          faceDown={faceDown}
          onPress={() => {}}
        />
      )
    );
    expect(view.toJSON()).toBeTruthy();
    await view.unmount();
  });
});

describe('NotificationBanner', () => {
  // Invariant: the banner is always mounted — visibility is animated, never
  // unmounted. Returning null on an empty notification is what previously
  // overwrote the slide-in. Asserted against the banner's own alert role, not
  // the tree as a whole, which any wrapper would keep non-null regardless.
  it('stays mounted with no notification', async () => {
    const view = await render(
      withSafeArea(<NotificationBanner notification={null} onDismiss={() => {}} />)
    );
    expect(view.getByRole('alert')).toBeTruthy();
    await view.unmount();
  });

  it('shows the message it is given', async () => {
    const view = await render(
      withSafeArea(
        <NotificationBanner
          notification={{ type: 'game_info', title: 'Titolo', message: 'Messaggio' }}
          onDismiss={() => {}}
        />
      )
    );
    expect(view.getByText('Messaggio')).toBeTruthy();
    await view.unmount();
  });
});
