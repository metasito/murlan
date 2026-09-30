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
import { LastCard } from '@/lib/theme';
import type { Player } from '@/lib/game/gameEngine';

const PLAYER: Player = { id: 'player_1', name: 'Besi', hand: [], type: 'human' };

async function badgeAt(cardCount: number) {
  const r = await render(<TopOppSlot player={PLAYER} isActive={false} cardCount={cardCount} />);
  const bubble = StyleSheet.flatten(screen.getByTestId('seat-card-count').props.style);
  const digit = StyleSheet.flatten(screen.getByText(String(cardCount)).props.style);
  await r.unmount();
  return { bubble, digit };
}

const glowOf = (style: { boxShadow?: unknown; shadowColor?: unknown }) => String(style.boxShadow ?? style.shadowColor ?? 'none');

describe('a seat down to its last card', () => {
  it("grows its badge by a quarter and paints it the mockup's .badge.last: red, a pale edge, white ink, a red glow", async () => {
    const many = await badgeAt(14);
    const last = await badgeAt(1);
    expect(last.bubble.height).toBeCloseTo((many.bubble.height as number) * 1.25);
    expect(last.bubble.backgroundColor).toBe(LastCard.fill);
    expect(last.bubble.borderColor).toBe(LastCard.edge);
    expect(last.digit.color).toBe(LastCard.ink);
    expect(glowOf(last.bubble)).toMatch(new RegExp(`${LastCard.glow}|255,90,70`, 'i'));
    expect(many.bubble.backgroundColor).not.toBe(LastCard.fill);
    expect(many.digit.color).not.toBe(LastCard.ink);
    expect(glowOf(many.bubble)).toBe('none');
  });
});
