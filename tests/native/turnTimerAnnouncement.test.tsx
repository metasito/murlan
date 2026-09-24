// tests/native/turnTimerAnnouncement.test.tsx — a live region speaks every time
// its text changes, and this one's text was a number that changed once a second:
// thirty interruptions a turn, every turn of a manche, over the banner, the seat
// state and the player's own hand. So the count is what is pinned here. Nothing
// renders differently either way, which is why no other test can see it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@/lib/device/sounds', () => ({
  playClockRunningOut: jest.fn(async () => {}),
  stopClockRunningOut: jest.fn(async () => {}),
  ensureAudioMode: jest.fn(async () => {}),
}));

import { TurnChip } from '@/components/table/turnChip';
import { urgentThresholdSeconds } from '@/components/turnTimerUi';
import { tn } from '@/lib/i18n';
import { liveRegions } from '../helpers/liveRegions';

const CLOCK_SECONDS = 30;
const THRESHOLD = urgentThresholdSeconds(CLOCK_SECONDS);
/** Shorter than the urgent threshold: a rejoin lands mid-turn on one of these. */
const SHORT_CLOCK = 3;

const secondsLeft = (n: number) => tn('gameTable.a11ySecondsLeft', n);

const seat = { lit: true, chipText: 'Your turn', spokenSeat: "It's your turn." } as const;

const clock = (seconds: number, active: boolean) => (
  <TurnChip seconds={seconds} active={active} resetKey="turn-1" scale={1} {...seat} />
);

/**
 * The sentences a reader would actually hear: a region announces a change of
 * its text, so an unchanged label is silence and so is an empty one.
 *
 * Exactly one region, checked every time it is read — two of them is the same
 * defect wearing a second node, and a sampler that took the first would not
 * notice.
 */
const heard = () => {
  const regions = liveRegions(screen);
  expect(regions).toHaveLength(1);
  return String(regions[0].props.accessibilityLabel ?? '');
};

const advanceOneSecond = async () => {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
};

/** Every distinct, non-empty sentence the region holds over `ticks` seconds. */
const utterancesOver = async (ticks: number) => {
  const spoken: string[] = [];
  let last = '';
  const sample = () => {
    const label = heard();
    if (label !== last && label !== '') spoken.push(label);
    last = label;
  };
  sample();
  for (let i = 0; i < ticks; i++) {
    await advanceOneSecond();
    sample();
  }
  return spoken;
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the turn countdown', () => {
  it('announces twice in a turn, not once a second', async () => {
    const r = await render(clock(CLOCK_SECONDS, true));

    expect(await utterancesOver(CLOCK_SECONDS)).toEqual([
      secondsLeft(CLOCK_SECONDS),
      secondsLeft(THRESHOLD),
    ]);
    await r.unmount();
  });

  // The half a mounted-and-active render cannot see. A region inserted with its
  // text already in it announces nothing — the node has to be there first and
  // change afterwards — and the chip is inactive between the viewer's turns,
  // so this is every turn's opening announcement, not an edge case.
  it('has the region in place before the turn starts, and speaks by changing it', async () => {
    const r = await render(clock(CLOCK_SECONDS, false));
    expect(heard()).toBe('');

    await act(async () => {
      r.rerender(clock(CLOCK_SECONDS, true));
    });
    expect(heard()).toBe(secondsLeft(CLOCK_SECONDS));

    await r.unmount();
  });

  // A clock already inside the urgent threshold has one moment, not two, and it
  // is the seconds really left — `urgentThresholdSeconds` floors at 5, so a
  // threshold read as the entry figure would tell a rejoining player 5 with 3.
  it('speaks the seconds it has when the clock is shorter than the threshold', async () => {
    const r = await render(clock(SHORT_CLOCK, true));
    expect(urgentThresholdSeconds(SHORT_CLOCK)).toBeGreaterThan(SHORT_CLOCK);

    expect(await utterancesOver(SHORT_CLOCK)).toEqual([secondsLeft(SHORT_CLOCK)]);
    await r.unmount();
  });

  // Silence is not stillness: the number on the chip goes on falling once a
  // second while the region says nothing. What a reader hears for it is the
  // chip's own name, which `turnChipLabel.test.tsx` follows down.
  it('still draws every second of the countdown', async () => {
    const r = await render(clock(CLOCK_SECONDS, true));

    for (let i = CLOCK_SECONDS; i > 0; i--) {
      expect(screen.queryByText(String(i), { includeHiddenElements: true })).not.toBeNull();
      await advanceOneSecond();
    }
    expect(screen.queryByText('0', { includeHiddenElements: true })).not.toBeNull();

    await r.unmount();
  });
});
