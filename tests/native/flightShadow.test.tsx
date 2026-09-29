// tests/native/flightShadow.test.tsx — a flying card carries no shadow of its own: the lamp
// shadow is the felt's (ADR-0008).
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { FlyingCards } from '@/components/table/pile';
import { pileSlots } from '@/components/flightPose';
import { flightSpec, NO_LANDING } from '@/components/table/useFlightClock';
import type { Card } from '@/lib/game/gameEngine';

const CARDS: Card[] = [
  { id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card,
  { id: 'A_hearts', rank: 'A', suit: 'hearts', isJoker: false } as Card,
];

describe('a flying card', () => {
  it('draws no lifted shadow', async () => {
    const from = CARDS.map(() => ({ x: 0, y: -100, rot: 0, scale: 0.4 }));
    const r = await render(
      <FlyingCards
        cards={CARDS}
        flight={flightSpec('k', from, pileSlots(2, 60, 400), false, false)}
        landing={NO_LANDING}
        signal={makeMutable(NO_LANDING)}
        onEnd={() => {}}
      />
    );

    expect(screen.queryByTestId('flying-shadow-lifted')).toBeNull();
    for (const node of screen.getAllByTestId('flying-card')) {
      const style = Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
      expect(style).not.toHaveProperty('shadowOpacity');
      expect(style).not.toHaveProperty('elevation');
      expect(style).not.toHaveProperty('boxShadow');
    }
    await r.unmount();
  });
});
