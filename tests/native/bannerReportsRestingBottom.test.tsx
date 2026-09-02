// tests/native/bannerReportsRestingBottom.test.tsx — the bottom the banner
// reports is the bottom it actually rests at.
//
// `MenuLayout` reserves top padding from this number, so a screen only clears
// the banner if the number matches where the banner really is. The banner used
// to forward the `y` its layout event carried; on web that event is a
// ResizeObserver, which reports a change of *size* and never one of *position*,
// so `y` is whatever the offset was when the box was last resized. An offset
// that moves under a box that keeps its height — a menu learning it is in
// landscape after first paint — left the reported bottom behind, and the
// screen reserved for a banner that had since slid down past its own header.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Landscape is where the offset is non-zero, so it is the only orientation in
// which a stale `y` and the true top differ at all.
const LANDSCAPE = { width: 844, height: 390, scale: 2, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => LANDSCAPE,
}));

import NotificationBanner from '@/components/NotificationBanner';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 24, left: 47, right: 34, bottom: 0 },
};

const HEIGHT = 70;
/** What the observer last saw, from before the offset moved. Any value that is
 *  not the resting top will do; this is the one the browser actually reported. */
const STALE_Y = 8;

const HIDDEN = { includeHiddenElements: true };
const noop = () => {};

describe('the banner it reports to', () => {
  it('is told the bottom of the box on screen, not the one the layout event remembers', async () => {
    const onMeasure = jest.fn();
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationBanner notification={null} onDismiss={noop} onMeasure={onMeasure} />
      </SafeAreaProvider>
    );

    await fireEvent(screen.getByTestId('notification-banner', HIDDEN), 'layout', {
      nativeEvent: { layout: { x: 0, y: STALE_Y, width: 760, height: HEIGHT } },
    });

    const top = StyleSheet.flatten(
      screen.getByTestId('notification-banner', HIDDEN).props.style
    ).top as number;
    // The premise of the test, not an assertion about the fix: with these two
    // equal the stale value would be correct by accident and nothing is proven.
    expect(top).not.toBe(STALE_Y);
    expect(onMeasure).toHaveBeenLastCalledWith(top + HEIGHT);

    await r.unmount();
  });
});
