import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { CardView } from '@/components/CardView';
import type { Card } from '@/lib/gameEngine';

// A labelled control must expose exactly one accessible node. Pressable already
// defaults `accessible` to true, but that alone does not remove its children
// from the accessibility tree — the visible label survives as a second node
// with the same text, so a screen reader announces the control twice and an
// automation tool cannot tell the two apart. Children of a labelled control
// have to be hidden explicitly.

const ACE: Card = { id: 'A-spades', rank: 'A', suit: 'spades', isJoker: false };

describe('a labelled control exposes one accessible node', () => {
  it('an unhidden text child is a second node — the shape being guarded against', async () => {
    const view = await render(
      <Pressable accessibilityRole="button" accessibilityLabel="Salta il tutorial">
        <Text>Salta</Text>
      </Pressable>
    );
    // Documents *why* the explicit hiding below is needed: without it the
    // child is still reachable, so this is not a redundant prop.
    expect(view.queryAllByText('Salta', { includeHiddenElements: false })).toHaveLength(1);
  });

  it('hiding the child leaves only the button', async () => {
    const view = await render(
      <Pressable accessibilityRole="button" accessibilityLabel="Salta il tutorial">
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          Salta
        </Text>
      </Pressable>
    );
    expect(view.queryAllByText('Salta', { includeHiddenElements: false })).toHaveLength(0);
    expect(view.getByLabelText('Salta il tutorial')).toBeTruthy();
  });
});

describe('CardView decorative', () => {
  it('announces itself by default', async () => {
    const view = await render(<CardView card={ACE} />);
    expect(view.queryAllByLabelText('Asso di Picche', { includeHiddenElements: false })).toHaveLength(1);
  });

  it('is silent when it is the content of an enclosing labelled control', async () => {
    // Both card pickers wrap a CardView in their own labelled Pressable. If the
    // CardView kept its label the card would be announced twice.
    const view = await render(
      <Pressable accessibilityRole="button" accessibilityLabel="Asso di Picche">
        <CardView card={ACE} decorative />
      </Pressable>
    );
    expect(view.queryAllByLabelText('Asso di Picche', { includeHiddenElements: false })).toHaveLength(1);
  });
});
