// tests/native/turnTimerAnnouncement.test.tsx — a live region speaks every time
// its text changes, and this one's text is a number that changes once a second.
// Left on the countdown itself, that is thirty interruptions a turn, for every
// turn of a manche, over the banner, the seat state and the player's own hand.
//
// So the count is the assertion, not the wording: a turn announces twice, on
// entry and when the clock turns urgent. An edit that puts the label back on
// the tick fails here rather than shipping silently — nothing renders
// differently, and no other test can see the difference.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('@/lib/sounds', () => ({
  playUrgentTick: jest.fn(async () => {}),
}));

import { TurnTimer } from '@/components/table/turnTimer';
import { urgentThresholdSeconds } from '@/components/turnTimerUi';
import { en as locale } from '@/locales/en';

const CLOCK_SECONDS = 30;
const THRESHOLD = urgentThresholdSeconds(CLOCK_SECONDS);

const secondsLeft = (n: number) =>
  locale[n === 1 ? 'gameTable.a11ySecondsLeft_one' : 'gameTable.a11ySecondsLeft_other'].replace(
    '{{count}}',
    String(n)
  );

/** Whatever node asks a reader to speak, in either platform's spelling. */
const liveRegion = () =>
  screen
    .queryAllByLabelText(/left to play/)
    .filter(
      (n) => n.props.accessibilityLiveRegion === 'polite' || n.props['aria-live'] === 'polite'
    );

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the turn countdown', () => {
  it('announces twice in a turn, not once a second', async () => {
    const r = await render(
      <TurnTimer seconds={CLOCK_SECONDS} active resetKey="turn-1" scale={1} />
    );

    // What a reader hears is the sequence of *distinct* texts the region has
    // held: an unchanged label is not re-announced.
    const spoken: string[] = [];
    const sample = () => {
      const [node] = liveRegion();
      expect(node).toBeDefined();
      const label = String(node.props.accessibilityLabel);
      if (label !== spoken[spoken.length - 1]) spoken.push(label);
    };

    sample();
    for (let i = 0; i < CLOCK_SECONDS; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      sample();
    }

    expect(spoken).toEqual([secondsLeft(CLOCK_SECONDS), secondsLeft(THRESHOLD)]);
    await r.unmount();
  });

  // Silence is not stillness: the number on the chip goes on falling once a
  // second. `includeHiddenElements` because the drawn digit is out of the
  // accessibility tree by design — a bare "12" read aloud says nothing, and
  // the sentence above is where that second is spoken.
  it('still draws every second of the countdown', async () => {
    const r = await render(
      <TurnTimer seconds={CLOCK_SECONDS} active resetKey="turn-1" scale={1} />
    );
    const drawnNow = (n: number) =>
      screen.queryByText(String(n), { includeHiddenElements: true });

    for (let i = CLOCK_SECONDS; i > 0; i--) {
      expect(drawnNow(i)).not.toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(drawnNow(0)).not.toBeNull();
    // …and it is the drawn digit alone that a reader is spared, not the count.
    expect(screen.queryByText('0')).toBeNull();
    await r.unmount();
  });
});
