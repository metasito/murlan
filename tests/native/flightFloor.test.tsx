// tests/native/flightFloor.test.tsx — a thrown combination always reaches the
// felt, even when its landing never reports back.
//
// While a flight is up, PlayedPile is rendered with `current={null}`: the cards
// in the air *are* the cards on the felt. The flight ends by way of a spring
// callback, and `finished` is false for every interruption — a cancelled
// animation, a remount mid-throw, a callback the worklet runtime never
// schedules. Any of those and the middle of the table stays empty until the
// round closes, which is what a player sees as the table going blank on
// somebody else's turn.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// The landing's callback never reaches the JS thread. That is the failure this
// exists for, stated at the one place the hand-off happens — the animation
// itself is left alone, so nothing else about the flight is pretended.
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { FlyingCards } from '@/components/table/pile';
import NotificationBanner from '@/components/NotificationBanner';
import { FLIGHT_MS } from '@/components/gameTableModel';
import type { Card } from '@/lib/gameEngine';

const METRICS = { frame: { x: 0, y: 0, width: 874, height: 402 }, insets: { top: 0, left: 59, right: 59, bottom: 21 } };
const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

const CARDS: Card[] = [{ id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card];

describe('a flight always hands the felt back', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('ends even when the landing callback never fires', async () => {
    const onDone = jest.fn();
    const r = await render(
      <FlyingCards cards={CARDS} direction="top" origin={{ dx: 0, dy: -100 }} onDone={onDone} roomW={400} scale={1} />
    );

    // Past the throw and its landing, and still nothing has reported.
    await act(async () => {
      jest.advanceTimersByTime(FLIGHT_MS);
    });
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(FLIGHT_MS * 3);
    });
    expect(onDone).toHaveBeenCalled();

    await r.unmount();
  });

  // The floor's own floor: a flight that is taken down must not fire later and
  // clear a pile that by then belongs to the next throw.
  it('does not report a flight that was unmounted', async () => {
    const onDone = jest.fn();
    const r = await render(
      <FlyingCards cards={CARDS} direction="left" origin={{ dx: -180, dy: 0 }} onDone={onDone} roomW={400} scale={1} />
    );
    await r.unmount();
    await act(async () => {
      jest.advanceTimersByTime(FLIGHT_MS * 5);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});

// The same shape, one component over: NotificationBanner also hands off to
// `onDismiss` only from a `finished` callback, and it is a full-width overlay
// across the top of the table. A broken chain there is a banner that never
// leaves.
describe('a banner always dismisses itself', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('dismisses even when the slide-out callback never fires', async () => {
    const onDismiss = jest.fn();
    const r = await render(
      withSafeArea(
        <NotificationBanner
          notification={{ id: 'n1', message: 'ciao', type: 'info' } as any}
          onDismiss={onDismiss}
        />
      )
    );

    await act(async () => {
      jest.advanceTimersByTime(4_500);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onDismiss).toHaveBeenCalled();

    await r.unmount();
  });

  it('does not dismiss a banner that is already gone', async () => {
    const onDismiss = jest.fn();
    const r = await render(
      withSafeArea(<NotificationBanner notification={null} onDismiss={onDismiss} />)
    );
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await r.unmount();
  });
});
