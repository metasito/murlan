// tests/native/seatFinishTrophy.test.tsx — a seat that has gone out shows a
// trophy in its count bubble (components/table/seats.tsx `SeatRing`) instead
// of its card count. The swap is the whole of what says "finished" — nothing
// asserted it existed before now.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { SideOppSlot, TopOppSlot } from '@/components/table/seats';
import type { Player } from '@/lib/game/gameEngine';

const player = (finishPosition?: number): Player => ({
  id: 'player_1',
  name: 'Besi',
  hand: [],
  type: 'human',
  finishPosition,
});

describe('the finished-seat trophy', () => {
  it('shows a trophy in the count bubble once the seat has gone out', async () => {
    const r = await render(<TopOppSlot player={player(1)} isActive={false} cardCount={0} />);
    expect(screen.getByTestId('seat-finish-trophy')).toBeVisible();
    await r.unmount();
  });

  it('shows the card count, not a trophy, while the seat is still playing', async () => {
    const r = await render(<TopOppSlot player={player(undefined)} isActive={false} cardCount={5} />);
    expect(screen.queryByTestId('seat-finish-trophy')).toBeNull();
    expect(screen.getByText('5')).toBeVisible();
    await r.unmount();
  });

  it('keeps the count and backs of a seat placed last while still holding cards', async () => {
    const r = await render(<TopOppSlot player={player(4)} isActive={false} cardCount={4} />);
    expect(screen.queryByTestId('seat-finish-trophy')).toBeNull();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.queryAllByTestId('seat-back', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    await r.unmount();
  });

  it('keeps the count and backs of a side seat placed last', async () => {
    const r = await render(<SideOppSlot side="left" player={player(4)} isActive={false} cardCount={3} />);
    expect(screen.queryByTestId('seat-finish-trophy')).toBeNull();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.queryAllByTestId('seat-back', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    await r.unmount();
  });
});
