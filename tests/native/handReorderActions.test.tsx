// tests/native/handReorderActions.test.tsx — the drag's single-pointer
// equivalent (#531).
//
// WCAG 2.5.7 Dragging Movements is Level AA and has no exception here:
// arranging a hand is a convenience, so a build where the only way to do it is
// a drag fails outright. The remedy is two discrete actions on the card, which
// cost no pixels and appear to nobody who is not asking for them — the same
// answer `Slider` and `ReplayControls` already give.
//
// Props, so this is the tier that can see it: `accessibilityActions` reaches
// react-native-web as nothing a browser can inspect, and only the native
// renderer keeps it.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { screen, render, fireEvent } from '@testing-library/react-native';
import { CardView } from '@/components/CardView';
import type { Card } from '@/lib/gameEngine';

const CARD: Card = { id: '7_hearts', rank: '7', suit: 'hearts' } as Card;
const ACTIONS = [
  { name: 'moveCardLeft', label: 'Move this card left' },
  { name: 'moveCardRight', label: 'Move this card right' },
];

describe('a hand card carries the drag as two discrete actions', () => {
  // The floor first: a card nobody may rearrange must not advertise that it
  // can be — an opponent's fan and a spectated hand pass no actions, and a
  // node that carried them regardless would satisfy everything below.
  it('offers nothing when the hand is not the viewer\'s to arrange', async () => {
    await render(<CardView card={CARD} onPress={() => {}} />);
    const node = screen.getByRole('button');
    expect(node.props.accessibilityActions).toBeUndefined();
    expect(node.props.onAccessibilityAction).toBeUndefined();
  });

  it('offers both directions, each with a name of its own', async () => {
    await render(
      <CardView card={CARD} onPress={() => {}} a11yActions={ACTIONS} onA11yAction={() => {}} />
    );
    expect(screen.getByRole('button').props.accessibilityActions).toEqual(ACTIONS);
  });

  it('reports which one was taken', async () => {
    const taken = jest.fn();
    await render(
      <CardView card={CARD} onPress={() => {}} a11yActions={ACTIONS} onA11yAction={taken} />
    );
    fireEvent(screen.getByRole('button'), 'accessibilityAction', {
      nativeEvent: { actionName: 'moveCardRight' },
    });
    expect(taken).toHaveBeenCalledWith('moveCardRight');
  });
});
