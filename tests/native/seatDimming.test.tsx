// tests/native/seatDimming.test.tsx — a seat off the turn recedes
// (SEAT_DIM_OPACITY, components/table/seats.tsx), which is one of four ways
// the table says whose turn it is — the countdown ring is a different claim,
// already pinned by tests/native/seatTurnClock.test.tsx. Colour (the ring's
// gold vs the disc's own tone) is not this channel; opacity is, and nothing
// asserted it before now.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { TopOppSlot, SideOppSlot } from '@/components/table/seats';
import type { Player } from '@/lib/gameEngine';

const player: Player = { id: 'player_1', name: 'Besi', hand: [], type: 'human' };

const opacityOf = (testId: string) => {
  const style = StyleSheet.flatten(screen.getByTestId(testId).props.style) as { opacity?: number };
  return style.opacity ?? 1;
};

describe('a seat off the turn recedes, not just its ring', () => {
  it('TopOppSlot dims when another seat is on move', async () => {
    const r = await render(<TopOppSlot player={player} isActive={false} cardCount={5} />);
    expect(opacityOf('top-seat')).toBeLessThan(1);
    await r.unmount();
  });

  it('TopOppSlot stays at full opacity on its own turn', async () => {
    const r = await render(<TopOppSlot player={player} isActive={true} cardCount={5} />);
    expect(opacityOf('top-seat')).toBe(1);
    await r.unmount();
  });

  it('SideOppSlot dims when another seat is on move', async () => {
    const r = await render(<SideOppSlot player={player} isActive={false} side="left" cardCount={5} />);
    expect(opacityOf('side-seat-left')).toBeLessThan(1);
    await r.unmount();
  });

  it('SideOppSlot stays at full opacity on its own turn', async () => {
    const r = await render(<SideOppSlot player={player} isActive={true} side="right" cardCount={5} />);
    expect(opacityOf('side-seat-right')).toBe(1);
    await r.unmount();
  });
});
