// tests/native/replayStaleRefresh.test.tsx — a replay on screen stays on screen
// when a background refresh fails, and says only that it could not refresh.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const combo = (type: string, cards: ReturnType<typeof card>[]) => ({ type, cards, strength: 1 });

const REPLAY = {
  id: 'r1',
  finishedAt: '2026-08-20T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u1', name: 'Ana' },
    { seatIndex: 1, userId: 'u2', name: 'Besi' },
  ],
  finishingOrder: [],
  moves: [
    { seat: 0, combo: combo('single', [card('3', 'spades')]), handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
  ],
};

import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { en as locale } from '@/locales/en';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';
import { queryClient } from '@/lib/query-client';
import { queriesSettled, renderApp } from './harness/renderApp';
import { httpRequests, route, unreachable } from './mocks/http';

const ReplayScreen = require('@/app/(online)/replay').default as React.ComponentType;

const t = (key: string) => translate(DEFAULT_LOCALE, key as TranslationKey);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 400 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const show = async (answer?: Parameters<typeof route>[2]) => {
  if (answer) route('GET', '/api/replays/r1', answer);
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReplayScreen />
    </SafeAreaProvider>,
    { user: { id: 'u1', username: 'Ana' } }
  );
  await queriesSettled();
  return view;
};

describe('a failed refresh of a replay', () => {
  it('keeps the table and the transport, with a quiet note above them', async () => {
    const view = await show({ body: REPLAY });
    route('GET', '/api/replays/r1', unreachable);
    await act(async () => void (await queryClient.refetchQueries({ queryKey: ['/api/replays/r1'] })));
    await queriesSettled();
    expect(view.getByText(locale['common.refreshFailed'])).toBeTruthy();
    expect(view.getByLabelText(t('replay.nextA11yLabel'))).toBeTruthy();
    expect(view.queryByText(locale['replay.loadFailedTitle'])).toBeNull();
    await view.unmount();
  });

  it('with no replay to show, is the full error with a retry', async () => {
    const view = await show(unreachable);
    expect(view.queryByText(locale['common.refreshFailed'])).toBeNull();
    const asked = () => httpRequests().filter((r) => r.path === '/api/replays/r1').length;
    const before = asked();
    await fireEvent.press(view.getByLabelText(t('replay.retryA11yLabel')));
    expect(asked()).toBe(before + 1);
    await view.unmount();
  });
});
