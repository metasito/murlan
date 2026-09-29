// tests/native/turnChipLabel.test.tsx — the turn chip is one node with one name.
//
// #1004 took the digit's own label off and put nothing in its place, so a reader
// landing on the chip heard the bare number beside a separate chip reading "Your
// turn". The group's name has to carry both, and the drawn words must not be a
// second stop for the same sentence.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { TurnChip } from '@/components/table/turnChip';
import { bootFeedback, effects, haptics, soundOf } from './helpers/feedback';
import { CLOCK_RUNNING_OUT_SECONDS } from '@/components/turnTimerUi';
import { tn } from '@/lib/i18n';
import { Colors } from '@/lib/theme';

const CLOCK_SECONDS = 30;
/** What `gameTable.a11yYourTurn` and `gameShared.yourTurn` are to this chip. */
const SPOKEN_SEAT = "It's your turn.";
const DRAWN_SEAT = 'Your turn';

const secondsLeft = (n: number) => tn('gameTable.a11ySecondsLeft', n);
const clockVoices = () => effects().filter((n) => soundOf(n) === 'clockRunningOut');

const chip = (active = true, lit = true) => (
  <TurnChip
    seconds={CLOCK_SECONDS}
    active={active}
    resetKey="turn-1"
    scale={1}
    lit={lit}
    chipText={DRAWN_SEAT}
    spokenSeat={SPOKEN_SEAT}
  />
);

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
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
    const r = await render(chip());
    const ticksToRunningOut = CLOCK_SECONDS - CLOCK_RUNNING_OUT_SECONDS;
    for (let i = 0; i < ticksToRunningOut - 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(clockVoices()).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(clockVoices()).toHaveLength(1);
    for (let i = 0; i < CLOCK_RUNNING_OUT_SECONDS - 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(clockVoices()).toHaveLength(1);
    expect(haptics()).toEqual([]);
    await r.unmount();
  });

  it.each([
    [true, true],
    [false, false],
  ])('turns ember at CLOCK_RUNNING_OUT_SECONDS left when lit (%s), with the sound', async (lit, ember) => {
    const dotIsEmber = () =>
      JSON.stringify(screen.getByTestId('turn-chip-dot', { includeHiddenElements: true }).props.style).includes(
        Colors.emberDot
      );
    const r = await render(chip(true, lit));
    for (let i = 0; i < CLOCK_SECONDS - CLOCK_RUNNING_OUT_SECONDS - 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(dotIsEmber()).toBe(false);
    expect(clockVoices()).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(dotIsEmber()).toBe(ember);
    expect(clockVoices()).toHaveLength(1);
    await r.unmount();
  });

  it('stops the clock-running-out sound when the chip unmounts mid-sound', async () => {
    const r = await render(chip());
    const ticksToRunningOut = CLOCK_SECONDS - CLOCK_RUNNING_OUT_SECONDS;
    for (let i = 0; i < ticksToRunningOut; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(clockVoices()).toHaveLength(1);
    expect(clockVoices()[0].stoppedAt).toBeUndefined();
    await r.unmount();
    expect(clockVoices()[0].stoppedAt).toBeDefined();
  });

  it('names the seat alone when no clock is running', async () => {
    const r = await render(chip(false));
    expect(screen.getAllByLabelText(SPOKEN_SEAT)).toHaveLength(1);
    await r.unmount();
  });
});
