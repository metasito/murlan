// tests/native/bannerPlacement.test.tsx — the notification banner does not sit
// on top of the game table's HUD.
//
// The banner is a sibling of the whole navigator at zIndex 9999; the table's
// HUD chips are at the same origin at zIndex 10. In landscape — the only
// orientation the table runs in — the banner now starts below them, and
// portrait, where every menu screen lives, is untouched.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LANDSCAPE = { width: 844, height: 390, scale: 2, fontScale: 1 };
const PORTRAIT = { width: 390, height: 844, scale: 2, fontScale: 1 };
let mockWindow = LANDSCAPE;

// useWindowDimensions is the only way the banner can tell it is over the
// table, and jest-expo's own window is a fixed portrait one.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

import NotificationBanner from '@/components/NotificationBanner';
import { CHIP_H, cardScale, computeScreenPads } from '@/components/gameTableModel';

const INSETS = { top: 24, left: 47, right: 34, bottom: 0 };
const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: INSETS };
const { topPad } = computeScreenPads({ insets: INSETS });
const SCALE = cardScale(Math.min(LANDSCAPE.width, LANDSCAPE.height));

const noop = () => {};

// No payload: the placement is computed from the viewport alone, and a live
// notification would leave its own 4.5s dwell timer running past the test.
const banner = (
  <SafeAreaProvider initialMetrics={METRICS}>
    <NotificationBanner notification={null} onDismiss={noop} />
  </SafeAreaProvider>
);

// Geometry, not reachability: with nothing to announce the banner is out of the
// accessibility tree, which is where the default query looks.
const HIDDEN = { includeHiddenElements: true };

const bannerTop = () =>
  StyleSheet.flatten(screen.getByTestId('notification-banner', HIDDEN).props.style).top as number;

describe('the notification banner', () => {
  it('starts below the HUD chips the game table draws, in landscape', async () => {
    mockWindow = LANDSCAPE;
    const r = await render(banner);

    expect(bannerTop()).toBeGreaterThanOrEqual(topPad + CHIP_H(SCALE));

    await r.unmount();
  });

  it('keeps its portrait placement, where there is no table under it', async () => {
    mockWindow = PORTRAIT;
    const r = await render(banner);

    expect(bannerTop()).toBeLessThan(topPad + CHIP_H(SCALE));

    await r.unmount();
  });

  it('is rendered with no notification to show', async () => {
    // CLAUDE.md: always mounted, never returns null — the fix moves it, it does
    // not gate it.
    mockWindow = LANDSCAPE;
    const r = await render(banner);

    expect(screen.getByTestId('notification-banner', HIDDEN)).toBeTruthy();

    await r.unmount();
  });

  // Always mounted means its close button is in the accessibility tree for the
  // whole session, announced and tabbable over a banner nobody can see.
  // `pointerEvents: "none"` answers for the pointer and for nothing else.
  it('offers no control while there is nothing to announce', async () => {
    mockWindow = LANDSCAPE;
    const r = await render(banner);

    expect(screen.queryAllByRole('button', { includeHiddenElements: false })).toHaveLength(0);

    await r.unmount();
  });

  it('gives the control back with the notification', async () => {
    mockWindow = LANDSCAPE;
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NotificationBanner
          notification={{ type: 'game_info', title: 'Tocca a te', message: 'Gioca una carta' }}
          onDismiss={noop}
        />
      </SafeAreaProvider>
    );

    // Two, because the banner offers two things: pressing the body runs the
    // notification's own action, and the close button dismisses without it.
    expect(screen.queryAllByRole('button', { includeHiddenElements: false })).toHaveLength(2);

    await r.unmount();
  });
});
