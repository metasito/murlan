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

  // A card with no onPress is information — the pile, or the card handed over
  // between hands. Naming it is right; calling it a button offers an action
  // that does not exist, and puts it in the button rotation of every screen
  // reader that has one.
  it('is not a button when it cannot be pressed', async () => {
    const view = await render(<CardView card={ACE} />);
    expect(view.queryAllByRole('button')).toHaveLength(0);
  });

  it('is a button when it can be pressed', async () => {
    const view = await render(<CardView card={ACE} onPress={() => {}} />);
    expect(view.queryAllByRole('button')).toHaveLength(1);
  });

  // A control that is temporarily unavailable is still a control. Dropping the
  // role would make the whole hand leave and rejoin a screen reader's button
  // rotation on every turn, and it is what the E2E harness locates cards by.
  it('stays a button while disabled, and reports itself unavailable', async () => {
    const view = await render(<CardView card={ACE} onPress={() => {}} disabled />);
    const buttons = view.queryAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityState?.disabled).toBe(true);
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
