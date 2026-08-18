import { describe, it, expect, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { FloatingReactions } from '@/components/ReactionLayer';
import { clearReactions, pushReaction } from '@/lib/reactions';

// A reaction lands in its own store, not in the online game context: an emoji
// in the context value re-renders the whole online screen — the table and every
// card in the hand — twice per reaction. FloatingReactions reads the store
// itself, so the write commits there and stops.
//
// The 2.5 s expiry is the store's, and tests/reactions.test.ts pins it there.
describe('a reaction re-renders the emoji layer and nothing above it', () => {
  afterEach(async () => {
    // Also cancels the pending removal, which would otherwise fire into the
    // next test.
    await act(async () => clearReactions());
  });

  it('does not re-render the component that renders FloatingReactions', async () => {
    let tableRenders = 0;
    // Stands in for OnlineGameScreen: it renders the emoji layer and knows
    // nothing else about reactions.
    function Table() {
      tableRenders += 1;
      return <FloatingReactions />;
    }

    await render(<Table />);
    const afterMount = tableRenders;

    await act(async () => {
      pushReaction({ emoji: '🔥', username: 'Ana', fromSeat: 1 });
    });

    expect(screen.getByText('🔥')).toBeTruthy();
    expect(tableRenders).toBe(afterMount);
  });

  it('names the sender, and follows the store when the reaction leaves it', async () => {
    await render(<FloatingReactions />);

    await act(async () => {
      pushReaction({ emoji: '👏', username: 'Besi', fromSeat: 2 });
    });
    expect(screen.getByText('👏')).toBeTruthy();
    expect(screen.getByText('Besi')).toBeTruthy();

    await act(async () => clearReactions());
    expect(screen.queryByText('👏')).toBeNull();
  });
});
