import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

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

  it('is not the last card while a deal has landed only one of thirteen', async () => {
    const dealArrivals = { at: Array.from({ length: 13 }, (_, i) => i * 100), clock: makeMutable(50) };
    const r = await render(<TopOppSlot player={PLAYER} isActive={false} cardCount={13} dealArrivals={dealArrivals} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('1')).toBeTruthy();
    const bubble = StyleSheet.flatten(screen.getByTestId('seat-card-count').props.style);
    expect(bubble.backgroundColor).not.toBe(LastCard.fill);
    expect(glowOf(bubble)).toBe('none');
    await r.unmount();
  });
});
