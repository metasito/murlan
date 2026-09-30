// tests/native/offlineBannerLargeText.test.tsx — the offline pill off the table, as G2 approved it
// (offline.shape=pill offline.tone=solid): white ink on a red deep enough for body-size text, capped
// at the table's font scale, one line, at Layer.alert; on the table the turn pill carries it instead.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNetListeners = new Set<(state: { isConnected: boolean | null }) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (l: (state: { isConnected: boolean | null }) => void) => {
      mockNetListeners.add(l);
      return () => mockNetListeners.delete(l);
    },
  },
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { OfflineBanner, useTableClaim } from '@/components/OfflineBanner';
import { Colors, Layer, TABLE_FONT_SCALE_MAX } from '@/lib/theme';

const METRICS = { frame: { x: 0, y: 0, width: 874, height: 402 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const hidden = { includeHiddenElements: true };
const net = (isConnected: boolean | null) => act(async () => mockNetListeners.forEach((l) => l({ isConnected })));
const Table = () => {
  useTableClaim();
  return null;
};

describe('the offline pill', () => {
  it('is white on the offline alert red, capped at the table scale, on one line, at Layer.alert', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OfflineBanner />
      </SafeAreaProvider>,
    );
    await net(false);
    const text = screen.getByTestId('offline-banner-text', hidden);
    const ink = StyleSheet.flatten(text.props.style);
    expect(ink.color).toBe(Colors.white);
    expect(text.props.maxFontSizeMultiplier).toBe(TABLE_FONT_SCALE_MAX);
    expect(text.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(screen.getByTestId('notice-offline', hidden).props.style).backgroundColor).toBe(Colors.offlineAlert);
    const banner = screen.getByTestId('offline-banner', hidden);
    expect(StyleSheet.flatten(banner.props.style).zIndex).toBe(Layer.alert);
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('assertive');
    await r.unmount();
  });

  it('flags offline only on isConnected === false', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OfflineBanner />
      </SafeAreaProvider>,
    );
    const live = () => screen.getByTestId('offline-banner', hidden).props.accessibilityLiveRegion;
    await net(null);
    expect(live()).toBe('none');
    await net(false);
    expect(live()).toBe('assertive');
    await r.unmount();
  });

  it('yields to a table on screen, except the instance drawn over one', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Table />
        <OfflineBanner />
        <OfflineBanner overTable />
      </SafeAreaProvider>,
    );
    await net(false);
    const regions = screen.getAllByTestId('offline-banner', hidden).map((b) => b.props.accessibilityLiveRegion);
    expect(regions).toEqual(['none', 'assertive']);
    await r.unmount();
  });
});
