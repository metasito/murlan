import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { TopOppSlot } from '@/components/table/seats';
import { Colors } from '@/lib/theme';
import type { Player } from '@/lib/gameEngine';

const PLAYER: Player = { id: 'player_1', name: 'Besi', hand: [], type: 'human' };

async function badgeAt(cardCount: number) {
  const r = await render(<TopOppSlot player={PLAYER} isActive={false} cardCount={cardCount} />);
  const bubble = StyleSheet.flatten(screen.getByTestId('seat-card-count').props.style);
  const digit = StyleSheet.flatten(screen.getByText(String(cardCount)).props.style);
  await r.unmount();
  return { bubble, digit };
}

describe('a seat down to its last card', () => {
  it('grows its badge by a quarter and lights its ring and digit', async () => {
    const many = await badgeAt(14);
    const last = await badgeAt(1);
    expect(last.bubble.height).toBeCloseTo((many.bubble.height as number) * 1.25);
    expect(last.bubble.borderColor).toBe(Colors.goldLit);
    expect(last.digit.color).toBe(Colors.goldLit);
    expect(many.bubble.borderColor).not.toBe(Colors.goldLit);
    expect(many.digit.color).not.toBe(Colors.goldLit);
  });
});
