// tests/native/seatDimming.test.tsx — a seat waiting for its turn stays at full
// strength (#1259 D4 #1, the mockup's `.seat`); only a reconnecting seat recedes.
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
import type { Player } from '@/lib/game/gameEngine';

const player: Player = { id: 'player_1', name: 'Besi', hand: [], type: 'human' };
const reconnecting = { seconds: 30, resetKey: 'drop-1' };

const opacityOf = (testId: string) => {
  const style = StyleSheet.flatten(screen.getByTestId(testId).props.style) as { opacity?: number };
  return style.opacity ?? 1;
};

const seats = [
  { name: 'TopOppSlot', testId: 'top-seat', seat: (props: object) => <TopOppSlot player={player} cardCount={5} isActive={false} {...props} /> },
  {
    name: 'SideOppSlot',
    testId: 'side-seat-left',
    seat: (props: object) => <SideOppSlot player={player} side="left" cardCount={5} isActive={false} {...props} />,
  },
];

describe.each(seats)('$name', ({ testId, seat }) => {
  it('is not dimmed while another seat is on move', async () => {
    const r = await render(seat({}));
    expect(opacityOf(testId)).toBe(1);
    await r.unmount();
  });

  it('is not dimmed on its own turn', async () => {
    const r = await render(seat({ isActive: true }));
    expect(opacityOf(testId)).toBe(1);
    await r.unmount();
  });

  it('still recedes while its player reconnects', async () => {
    const r = await render(seat({ reconnecting }));
    const dim = opacityOf(testId);
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBeLessThan(1);
    await r.unmount();
  });
});
