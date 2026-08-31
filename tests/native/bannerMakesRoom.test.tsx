// tests/native/bannerMakesRoom.test.tsx — a menu screen reserves the space a
// visible banner occupies.
//
// The banner floats over the navigator at zIndex 9999, so nothing below it
// knows it is there. This pins the wiring that tells it: the banner reports the
// window y it reaches down to, and `MenuLayout` turns that into top padding.
//
// Only a browser can prove nothing is *covered* — react-test-renderer never
// runs flexbox, and `tests/e2e/bannerDisplaces.spec.ts` is where that claim
// lives. What this proves is that the number gets from one side to the other,
// which is the half that silently stops working when a prop is dropped.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));

import { MenuLayout } from '@/components/MenuLayout';
import {
  NotificationProvider,
  useNotification,
  type NotificationData,
} from '@/context/NotificationContext';
import { TOP_GAP } from '@/components/NotificationBanner';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const NOTICE: NotificationData = {
  type: 'game_error',
  title: 'Troppo in fretta',
  message: 'Aspetta un momento prima di riprovare.',
};

/** Drives the provider the way the banner and a caller would. */
let raise: (n: NotificationData) => void = () => {};
let measure: (bottom: number) => void = () => {};
let dismiss: () => void = () => {};

function Harness() {
  const { showNotification, reportBannerBottom, dismissNotification } = useNotification();
  raise = showNotification;
  measure = reportBannerBottom;
  dismiss = dismissNotification;
  return (
    <MenuLayout>
      <Text>content</Text>
    </MenuLayout>
  );
}

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <Harness />
      </NotificationProvider>
    </SafeAreaProvider>
  );

const padTop = () =>
  StyleSheet.flatten(screen.getByTestId('menu-content').props.style).paddingTop as number;

describe('a menu screen and a banner over it', () => {
  it('reserves nothing while there is nothing to announce', async () => {
    const r = await mount();
    const quiet = padTop();

    // The banner measures itself on every layout pass, notification or not.
    await act(async () => measure(96));
    expect(padTop()).toBe(quiet);

    await r.unmount();
  });

  it('makes room for a banner that is up, clear of it by the same gap', async () => {
    const r = await mount();
    const quiet = padTop();

    await act(async () => {
      raise(NOTICE);
      measure(96);
    });

    expect(padTop()).toBe(96 + TOP_GAP);
    expect(padTop()).toBeGreaterThan(quiet);

    await r.unmount();
  });

  it('reserves the banner it actually has, not a guess at one', async () => {
    const r = await mount();

    await act(async () => {
      raise(NOTICE);
      measure(96);
    });
    const short = padTop();

    // A second line of message text is a taller banner.
    await act(async () => measure(140));

    expect(padTop()).toBe(140 + TOP_GAP);
    expect(padTop()).toBeGreaterThan(short);

    await r.unmount();
  });

  it('gives the room back when the banner leaves', async () => {
    const r = await mount();
    const quiet = padTop();

    await act(async () => {
      raise(NOTICE);
      measure(96);
    });
    expect(padTop()).toBeGreaterThan(quiet);

    await act(async () => dismiss());
    expect(padTop()).toBe(quiet);

    await r.unmount();
  });
});
