import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { getAnimatedStyle } from 'react-native-reanimated';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setMotionPreference, type MotionPreference } from '@/lib/accessibility';
import { useEntrance } from '@/lib/useEntrance';
import { Motion } from '@/lib/theme';

const { ReducedMotionManager } = require('react-native-reanimated/lib/module/ReducedMotion');

jest.mock('expo-router', () => {
  function Stack({ children }: { children?: unknown }) {
    return children ?? null;
  }
  Stack.Screen = function StackScreen() {
    return null;
  };
  Stack.Protected = function StackProtected({ children }: { children?: unknown }) {
    return children ?? null;
  };
  return { Stack, usePathname: () => '/', router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } };
});
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

import { NotificationProvider } from '@/context/NotificationContext';
import { RootLayoutNav } from '@/app/_layout';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const STEP = 5;
const DELAY_MS = STEP * Motion.duration.tap;

function Item() {
  return <Animated.View testID="item" style={useEntrance(STEP)} />;
}

async function opacityAfter(system: boolean, preference: MotionPreference, ms: number): Promise<number> {
  ReducedMotionManager.setEnabled(system);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(system);
  setMotionPreference(preference);
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <View>
          <RootLayoutNav />
        </View>
      </NotificationProvider>
    </SafeAreaProvider>
  );
  await act(async () => {});
  await r.rerender(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NotificationProvider>
        <View>
          <RootLayoutNav />
          <Item />
        </View>
      </NotificationProvider>
    </SafeAreaProvider>
  );
  for (let t = 0; t < ms; t += 16) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
  const opacity = (getAnimatedStyle(screen.getByTestId('item')) as { opacity: number }).opacity;
  await r.unmount();
  return opacity;
}

describe("the app's motion setting decides for Reanimated's withDelay, over the system flag", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => {},
    } as ReturnType<typeof AccessibilityInfo.addEventListener>);
  });
  afterEach(() => {
    setMotionPreference('system');
    ReducedMotionManager.setEnabled(false);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('Full keeps an entrance stagger waiting although the system asks to reduce', async () => {
    expect(await opacityAfter(true, 'off', DELAY_MS / 2)).toBe(0);
  });

  it('Reduced skips the stagger although the system does not ask to', async () => {
    expect(await opacityAfter(false, 'on', DELAY_MS / 2)).toBe(1);
  });

  it('System follows the system flag', async () => {
    expect(await opacityAfter(true, 'system', DELAY_MS / 2)).toBe(1);
    expect(await opacityAfter(false, 'system', DELAY_MS / 2)).toBe(0);
  });
});
