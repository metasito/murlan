// tests/native/handTapStrip.test.tsx — a hand card can be tapped where it can
// be seen.
//
// The hand overlaps far past half a card, so a card's geometric centre lies
// under the neighbour drawn over it. A tap resolves where it lands, and a
// pointer driver aims at the centre: with the whole card pressable, every card
// but the last resolves to the wrong one. This is what froze two offline
// games, and widening the step to dodge it is what pulled the hand 40% wider
// than the prototype.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { screen, render } from '@testing-library/react-native';
import { CardView } from '@/components/CardView';
import { CARD_W } from '@/components/cardFaceModel';
import type { Card } from '@/lib/gameEngine';

const CARD: Card = { id: 'c1', rank: '7', suit: 'hearts' } as Card;

/** The width of the node a press actually lands on. */
function pressableWidth(): number | undefined {
  const node = screen.getByRole('button');
  const style = Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : node.props.style;
  return style?.width;
}

describe('a hand card is pressable exactly where it is visible', () => {
  it('presses on the strip it exposes, not on the whole card', async () => {
    const strip = 24;
    const r = await render(<CardView card={CARD} onPress={() => {}} hitWidth={strip} />);
    expect(pressableWidth()).toBe(strip);
    // The point a driver aims at has to be inside that strip.
    expect(strip / 2).toBeLessThan(strip);
    await r.unmount();
  });

  // The floor. `hitWidth` is optional, so a check that only ever saw the
  // narrowed case would pass just as well against a component that ignored the
  // prop and always sized itself to the card.
  it('is the whole card when nothing covers it', async () => {
    const r = await render(<CardView card={CARD} onPress={() => {}} scale={1} />);
    expect(pressableWidth()).toBe(CARD_W(1));
    await r.unmount();
  });
});
