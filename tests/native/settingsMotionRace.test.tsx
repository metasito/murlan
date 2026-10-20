// A stored reduced-motion choice holds through SettingsProvider's mount: nothing pushes its unread
// `'system'` default while the stored read is still out.
import { test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { getMotionPreference, setMotionPreference } from '@/lib/accessibility';
import { SettingsProvider } from '@/context/SettingsContext';
import type { Card } from '@/lib/game/gameEngine';
import { flightOf, pileOf } from './helpers/landing';

const CARDS: Card[] = [{ id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card];

const thrownFrom = { x: 0, y: -100, rot: 0, scale: 0.4 };

function cardScale(view: Awaited<ReturnType<typeof render>>): number | undefined {
  const style = getAnimatedStyle(view.getByTestId('flying-card', { includeHiddenElements: true })) as { transform?: Record<string, number>[] };
  return style.transform?.find((t) => 'scale' in t)?.scale;
}

async function mountWithReadOutstanding(stored: string | null) {
  setMotionPreference('on');
  let releaseRead!: (raw: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
    () => new Promise((resolve) => { releaseRead = resolve; })
  );
  const flight = flightOf('k', CARDS, [thrownFrom]);
  const view = await render(<SettingsProvider>{pileOf({ plays: [flight], flights: [flight] })}</SettingsProvider>);
  await act(async () => { jest.advanceTimersByTime(16); });
  return { view, release: () => act(async () => { releaseRead(stored); }) };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  setMotionPreference('system');
  jest.useRealTimers();
});

test('a stored reduced-motion choice holds, on the accessibility layer and on the table, before the stored read resolves', async () => {
  const { view, release } = await mountWithReadOutstanding(JSON.stringify({ motion: 'on' }));

  expect(cardScale(view)).toBe(1);
  expect(getMotionPreference()).toBe('on');

  await release();
  expect(getMotionPreference()).toBe('on');
  await view.unmount();
});

test('with nothing stored, the read still lands the system default once it completes', async () => {
  const { view, release } = await mountWithReadOutstanding(null);

  await release();
  expect(getMotionPreference()).toBe('system');
  await view.unmount();
});
