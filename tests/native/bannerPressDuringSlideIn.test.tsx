import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NotificationBanner, { SLIDE_DURATION } from '@/components/NotificationBanner';
import type { NotificationData } from '@/context/NotificationContext';

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

describe('pressing the banner while it slides in', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('dismisses once, with no second hold started by the cancelled slide-in', async () => {
    jest.useFakeTimers();
    let view: Awaited<ReturnType<typeof render>> | undefined;
    const tree = (notification: NotificationData | null) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationBanner notification={notification} onDismiss={onDismiss} />
      </SafeAreaProvider>
    );
    const onDismiss = jest.fn(() => view?.rerender(tree(null)));
    view = await render(tree(NOTICE));

    await advance(SLIDE_DURATION / 2);
    await fireEvent.press(screen.getByRole('button', { name: /online2/ }));
    await advance(NOTICE.duration! + 4 * SLIDE_DURATION);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
