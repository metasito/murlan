import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NotificationBanner, { SLIDE_DURATION } from '@/components/NotificationBanner';
import type { NotificationData } from '@/context/NotificationContext';

// The `lib/module` copy: jest resolves the package there, and the `src/` copy is a different module.
const { ReducedMotionManager } = require('react-native-reanimated/lib/module/ReducedMotion');

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};
const NOTICE: NotificationData = { type: 'afk', title: 'online2', message: 'idle', duration: 4000 };

async function advance(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
}

describe('the notification banner under the system reduce-motion setting', () => {
  afterEach(() => {
    ReducedMotionManager.setEnabled(false);
    jest.useRealTimers();
  });

  it('stays up for its own duration, then dismisses', async () => {
    jest.useFakeTimers();
    ReducedMotionManager.setEnabled(true);
    const onDismiss = jest.fn();
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationBanner notification={NOTICE} onDismiss={onDismiss} />
      </SafeAreaProvider>
    );

    await advance(1000);
    expect(onDismiss).not.toHaveBeenCalled();

    await advance(NOTICE.duration! + 2 * SLIDE_DURATION - 1000);
    expect(onDismiss).toHaveBeenCalled();

    await r.unmount();
  });
});
