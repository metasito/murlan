// A cold start with reduced motion stored never runs the table's full-motion path: not before
// any stored read lands, and not in the window where SettingsProvider's own read is still out.
// Nothing above the test body may load lib/accessibility: this file's first load of it is the launch.
import { test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY } from '@/lib/storageKeys';
import type { Card } from '@/lib/game/gameEngine';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

const CARDS: Card[] = [{ id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card];
const STORED_REDUCED = JSON.stringify({ motion: 'on' });

function cardScale(view: Awaited<ReturnType<typeof render>>): number | undefined {
  const style = getAnimatedStyle(view.getByTestId('flying-card', { includeHiddenElements: true })) as { transform?: Record<string, number>[] };
  return style.transform?.find((t) => 'scale' in t)?.scale;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('a stored reduced-motion choice holds from launch, before any read lands and while SettingsProvider’s is out', async () => {
  const held: ((raw: string | null) => void)[] = [];
  jest.mocked(AsyncStorage.getItem).mockImplementation((key: string) =>
    key === SETTINGS_KEY ? new Promise((resolve) => { held.push(resolve); }) : Promise.resolve(null)
  );
  const { getMotionPreference } = require('@/lib/accessibility') as typeof import('@/lib/accessibility');
  const { SettingsProvider } = require('@/context/SettingsContext') as typeof import('@/context/SettingsContext');
  const { flightOf, pileOf } = require('./helpers/landing') as typeof import('./helpers/landing');
  const preloads = held.length;

  const flight = flightOf('k', CARDS, [{ x: 0, y: -100, rot: 0, scale: 0.4 }]);
  const view = await render(<SettingsProvider>{pileOf({ plays: [flight], flights: [flight] })}</SettingsProvider>);
  await act(async () => { jest.advanceTimersByTime(16); });
  expect(cardScale(view)).toBe(1);
  expect(getMotionPreference()).toBe('on');

  await act(async () => { held.splice(0, preloads).forEach((r) => r(STORED_REDUCED)); });
  await act(async () => { jest.advanceTimersByTime(16); });
  expect(held.length).toBeGreaterThan(0);
  expect(cardScale(view)).toBe(1);
  expect(getMotionPreference()).toBe('on');

  await act(async () => { held.splice(0).forEach((r) => r(STORED_REDUCED)); });
  expect(getMotionPreference()).toBe('on');
  await view.unmount();
});

/** lib/accessibility loaded fresh, its stored read answered by `read` on the AsyncStorage instance it requires. */
function coldAccessibility(read: () => Promise<string | null>) {
  let accessibility!: typeof import('@/lib/accessibility');
  let getItem!: jest.Mock;
  jest.isolateModules(() => {
    const loaded = require('@react-native-async-storage/async-storage') as typeof AsyncStorage & { default?: typeof AsyncStorage };
    const storage = loaded.default ?? loaded;
    getItem = jest.mocked(storage.getItem).mockImplementation(read) as unknown as jest.Mock;
    getItem.mockClear();
    accessibility = require('@/lib/accessibility');
  });
  return { accessibility, getItem };
}

test('a stored full-motion choice is held reduced until the read lands, then settles on it', async () => {
  let release!: (raw: string | null) => void;
  const { accessibility, getItem } = coldAccessibility(() => new Promise((resolve) => { release = resolve; }));
  expect(getItem).toHaveBeenCalledWith(SETTINGS_KEY);
  expect(accessibility.getMotionPreference()).toBe('on');

  await act(async () => { release(JSON.stringify({ motion: 'off' })); });
  expect(accessibility.getMotionPreference()).toBe('off');
});

test.each([
  ['nothing is stored (a fresh install)', () => Promise.resolve(null)],
  ['the read fails', () => Promise.reject(new Error('storage unavailable'))],
  ['the stored value is not JSON', () => Promise.resolve('{not json')],
])('motion settles on the system default when %s', async (_, read) => {
  const { accessibility, getItem } = coldAccessibility(read);
  expect(getItem).toHaveBeenCalledWith(SETTINGS_KEY);
  expect(accessibility.getMotionPreference()).toBe('on');

  await act(async () => {});
  expect(accessibility.getMotionPreference()).toBe('system');
});
