// tests/native/seatReconnectClock.test.tsx — #850 clauses 1-2: the seat's own
// disconnect countdown for the whole grace, driven only by the server's own
// `seconds` (never a second client-side clock), and the vacated flag's chip.
// Mounted directly, the same way tests/native/seatDimming.test.tsx does —
// TopOppSlot is where both chips actually render, and skipping the full
// <GameTable> keeps this a tree question, not a layout one.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { TopOppSlot } from '@/components/table/seats';
import type { Player } from '@/lib/gameEngine';

const player: Player = { id: 'player_1', name: 'Besi', hand: [], type: 'human' };

/** The chip's own text, read by testID rather than by content — cardCount
 *  renders digits of its own, and a bare number regex can match either. */
const chipText = () => screen.getByTestId('seat-reconnect-chip').props.children;

describe("a seat's disconnect countdown (#850 clause 1)", () => {
  it('starts from the server-supplied seconds, not from zero or a guess', async () => {
    const r = await render(
      <TopOppSlot
        player={player}
        isActive={false}
        cardCount={5}
        reconnecting={{ seconds: 47, resetKey: 'a' }}
      />
    );
    expect(chipText()).toContain('47');
    await r.unmount();
  });

  it('ticks down locally in whole seconds without any server push', async () => {
    jest.useFakeTimers();
    const r = await render(
      <TopOppSlot
        player={player}
        isActive={false}
        cardCount={5}
        reconnecting={{ seconds: 10, resetKey: 'b' }}
      />
    );
    expect(chipText()).toContain('10');

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(chipText()).toContain('7');

    await r.unmount();
    jest.useRealTimers();
  });

  it('a fresh resetKey restarts from the new seconds, proving there is no clock of its own', async () => {
    jest.useFakeTimers();
    const r = await render(
      <TopOppSlot
        player={player}
        isActive={false}
        cardCount={5}
        reconnecting={{ seconds: 20, resetKey: 'first' }}
      />
    );
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(chipText()).toContain('5');

    // The server re-announced the grace (a fresh disconnect on the same
    // seat) with its own new seconds — the chip must restart from that
    // value rather than keep counting down whatever it had locally.
    await act(async () => {
      r.rerender(
        <TopOppSlot
          player={player}
          isActive={false}
          cardCount={5}
          reconnecting={{ seconds: 20, resetKey: 'second' }}
        />
      );
    });
    expect(chipText()).toContain('20');

    await r.unmount();
    jest.useRealTimers();
  });

  it('renders nothing for a seat with no grace running', async () => {
    const r = await render(<TopOppSlot player={player} isActive={false} cardCount={5} />);
    expect(screen.queryByTestId('seat-reconnect-chip')).toBeNull();
    await r.unmount();
  });
});

describe('a vacated seat (#850 clause 2)', () => {
  it('renders the vacated chip through t(), never server-written text', async () => {
    const r = await render(
      <TopOppSlot player={player} isActive={false} cardCount={5} vacated={true} />
    );
    expect(screen.getByTestId('seat-vacated-chip')).toBeTruthy();
    await r.unmount();
  });

  it('a reconnecting seat outranks its own vacated chip — they never show at once', async () => {
    const r = await render(
      <TopOppSlot
        player={player}
        isActive={false}
        cardCount={5}
        vacated={true}
        reconnecting={{ seconds: 12, resetKey: 'x' }}
      />
    );
    expect(screen.getByTestId('seat-reconnect-chip')).toBeTruthy();
    expect(screen.queryByTestId('seat-vacated-chip')).toBeNull();
    await r.unmount();
  });
});
