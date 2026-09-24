// tests/native/turnChipLabel.test.tsx — the turn chip is one node with one name.
//
// #1004 took the digit's own label off and put nothing in its place, so a reader
// landing on the chip heard the bare number beside a separate chip reading "Your
// turn". The group's name has to carry both, and the drawn words must not be a
// second stop for the same sentence.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@/lib/device/sounds', () => ({
  playClockRunningOut: jest.fn(async () => {}),
  stopClockRunningOut: jest.fn(async () => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('@/lib/device/haptics', () => ({ hapticSelection: jest.fn() }));

import { TurnChip } from '@/components/table/turnChip';
import { hapticSelection } from '@/lib/device/haptics';
import { playClockRunningOut, stopClockRunningOut } from '@/lib/device/sounds';
import { CLOCK_RUNNING_OUT_SECONDS } from '@/components/turnTimerUi';
import { tn } from '@/lib/i18n';

const CLOCK_SECONDS = 30;
/** What `gameTable.a11yYourTurn` and `gameShared.yourTurn` are to this chip. */
const SPOKEN_SEAT = "It's your turn.";
const DRAWN_SEAT = 'Your turn';

const secondsLeft = (n: number) => tn('gameTable.a11ySecondsLeft', n);

const chip = (active = true) => (
  <TurnChip
    seconds={CLOCK_SECONDS}
    active={active}
    resetKey="turn-1"
    scale={1}
    lit
    chipText={DRAWN_SEAT}
    spokenSeat={SPOKEN_SEAT}
  />
);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the turn chip', () => {
  it('reads the seat state and the seconds left as one node', async () => {
    const r = await render(chip());
    expect(
      screen.getAllByLabelText(`${SPOKEN_SEAT} ${secondsLeft(CLOCK_SECONDS)}`)
    ).toHaveLength(1);
    await r.unmount();
  });

  it('offers neither its drawn words nor its digit as a second stop', async () => {
    const r = await render(chip());
    expect(screen.queryByText(DRAWN_SEAT)).toBeNull();
    expect(screen.queryByText(String(CLOCK_SECONDS))).toBeNull();
    // Withdrawn from a reader, still drawn on the screen.
    expect(screen.queryByText(DRAWN_SEAT, { includeHiddenElements: true })).not.toBeNull();
    expect(
      screen.queryByText(String(CLOCK_SECONDS), { includeHiddenElements: true })
    ).not.toBeNull();
    await r.unmount();
  });

  // A name is spoken on landing, not on change, so it may hold the seconds the
  // live region deliberately stops saying — and a reader going looking mid-turn
  // has to get the seconds really left, not the turn's opening figure.
  it('follows the clock down, every second of it', async () => {
    const r = await render(chip());
    for (let i = CLOCK_SECONDS; i > 0; i--) {
      expect(screen.getAllByLabelText(`${SPOKEN_SEAT} ${secondsLeft(i)}`)).toHaveLength(1);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    await r.unmount();
  });

  it('sounds once, at CLOCK_RUNNING_OUT_SECONDS left, and never buzzes', async () => {
    jest.mocked(hapticSelection).mockClear();
    jest.mocked(playClockRunningOut).mockClear();
    const r = await render(chip());
    const ticksToRunningOut = CLOCK_SECONDS - CLOCK_RUNNING_OUT_SECONDS;
    for (let i = 0; i < ticksToRunningOut - 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(jest.mocked(playClockRunningOut)).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(jest.mocked(playClockRunningOut)).toHaveBeenCalledTimes(1);
    for (let i = 0; i < CLOCK_RUNNING_OUT_SECONDS - 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(jest.mocked(playClockRunningOut)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(hapticSelection)).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('stops the clock-running-out sound when the chip unmounts mid-sound', async () => {
    jest.mocked(playClockRunningOut).mockClear();
    jest.mocked(stopClockRunningOut).mockClear();
    const r = await render(chip());
    const ticksToRunningOut = CLOCK_SECONDS - CLOCK_RUNNING_OUT_SECONDS;
    for (let i = 0; i < ticksToRunningOut; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(jest.mocked(playClockRunningOut)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(stopClockRunningOut)).not.toHaveBeenCalled();
    await r.unmount();
    expect(jest.mocked(stopClockRunningOut)).toHaveBeenCalledTimes(1);
  });

  it('names the seat alone when no clock is running', async () => {
    const r = await render(chip(false));
    expect(screen.getAllByLabelText(SPOKEN_SEAT)).toHaveLength(1);
    await r.unmount();
  });
});
