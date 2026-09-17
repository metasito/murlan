import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { MenuButton } from '@/components/MenuButton';

// iOS reads `overflow: hidden` as masksToBounds, and a masked layer casts no shadow.
describe('MenuButton casts its shadow from a view that does not clip', () => {
  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)('%s', async (variant) => {
    const view = await render(<MenuButton label="Gioca" variant={variant} onPress={() => {}} />);
    const styles: Record<string, unknown>[] = [];
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      styles.push(StyleSheet.flatten(node.props?.style) ?? {});
      walk(node.children);
    };
    walk(view.toJSON());
    const clipped = styles.filter((s) => s.overflow === 'hidden');
    expect(clipped).not.toHaveLength(0);
    expect(clipped.every((s) => s.boxShadow === undefined)).toBe(true);
    expect(styles.some((s) => s.boxShadow !== undefined && s.overflow !== 'hidden')).toBe(true);
    await view.unmount();
  });
});
