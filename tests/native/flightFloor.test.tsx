// tests/native/flightFloor.test.tsx — a banner always leaves, even when its
// slide-out never reports back.
//
// NotificationBanner hands off to `onDismiss` only from a `finished` callback,
// and it is a full-width overlay across the top of the table. A broken chain
// there is a banner that never leaves.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import NotificationBanner from '@/components/NotificationBanner';

const METRICS = { frame: { x: 0, y: 0, width: 874, height: 402 }, insets: { top: 0, left: 59, right: 59, bottom: 21 } };
const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

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
