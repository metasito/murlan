import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { MenuButton } from '@/components/MenuButton';
import { sq } from '@/locales/sq';

describe('MenuButton gives a long label room rather than an ellipsis', () => {
  it('wraps to a second line and shrinks beside an icon', async () => {
    const view = await render(
      <MenuButton label={sq['onlineLobby.enterRoomCode']} onPress={() => {}} />
    );
    const text = view.getByText(sq['onlineLobby.enterRoomCode'], { includeHiddenElements: true });
    expect(text.props.numberOfLines).toBeGreaterThan(1);
    expect(StyleSheet.flatten(text.props.style).flexShrink).toBe(1);
    await view.unmount();
  });
});
