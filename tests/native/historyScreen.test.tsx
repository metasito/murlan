// tests/native/historyScreen.test.tsx — every hand the player has, a page at
// a time. The property under test is that it pages: an endless scroll is the
// defect #678 exists to remove, so a list with no last page would be the same
// defect one screen along.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: mockBack, push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const mockData: Record<string, unknown> = {};
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: mockData[queryKey[0]],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: jest.fn(),
  }),
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

import { SettingsProvider } from '@/context/SettingsContext';

const HistoryScreen = require('@/app/(online)/history').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** Each hand is given the seat name its index makes, so a row is identifiable. */
const hands = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    userId: 'u1',
    finishedAt: new Date(Date.UTC(2026, 7, 19)).toISOString(),
    gameMode: 'free_for_all',
    placement: 2,
    playerCount: 3,
    points: 1,
    opponents: [],
    participants: [{ name: `Seat${i}`, bot: false }],
    replayId: null,
  }));

/** A row is found by its seats, which live in the row's own label. */
const seats = (names: string) =>
  new RegExp(t('history.with', { names }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

function show(history: unknown[]) {
  mockData['/api/stats/history'] = history;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsProvider>
        <HistoryScreen />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  for (const key of Object.keys(mockData)) delete mockData[key];
  mockBack.mockClear();
});

describe('the full history screen', () => {
  it('shows one page of hands and says which page it is', async () => {
    const view = await show(hands(23));
    await act(async () => {});

    expect(view.getByText(t('history.pageLabel', { page: 1, total: 3 }))).toBeTruthy();
    expect(view.getByLabelText(seats('Seat0'))).toBeTruthy();
    expect(view.queryByLabelText(seats('Seat10'))).toBeNull();
    await view.unmount();
  });

  it('walks forward and back through the pages', async () => {
    const view = await show(hands(23));
    await act(async () => {});

    await fireEvent.press(view.getByLabelText(t('history.nextA11yLabel')));
    expect(view.getByText(t('history.pageLabel', { page: 2, total: 3 }))).toBeTruthy();
    expect(view.getByLabelText(seats('Seat10'))).toBeTruthy();
    expect(view.queryByLabelText(seats('Seat0'))).toBeNull();

    await fireEvent.press(view.getByLabelText(t('history.prevA11yLabel')));
    expect(view.getByText(t('history.pageLabel', { page: 1, total: 3 }))).toBeTruthy();
    expect(view.getByLabelText(seats('Seat0'))).toBeTruthy();
    await view.unmount();
  });

  // The last page is short, and it is the last: there is no page four to walk
  // into, which is the whole difference from a scroll that never ends.
  it('ends, with a final page that is not full', async () => {
    const view = await show(hands(23));
    await act(async () => {});

    await fireEvent.press(view.getByLabelText(t('history.nextA11yLabel')));
    await fireEvent.press(view.getByLabelText(t('history.nextA11yLabel')));
    expect(view.getByText(t('history.pageLabel', { page: 3, total: 3 }))).toBeTruthy();
    expect(view.getByLabelText(seats('Seat22'))).toBeTruthy();

    await fireEvent.press(view.getByLabelText(t('history.nextA11yLabel')));
    expect(view.getByText(t('history.pageLabel', { page: 3, total: 3 }))).toBeTruthy();
    await view.unmount();
  });

  it('offers no paging at all when everything fits on one page', async () => {
    const view = await show(hands(4));
    await act(async () => {});

    expect(view.queryByLabelText(t('history.nextA11yLabel'))).toBeNull();
    expect(view.queryByLabelText(t('history.prevA11yLabel'))).toBeNull();
    expect(view.getByLabelText(seats('Seat3'))).toBeTruthy();
    await view.unmount();
  });

  it('says so when there are no hands at all', async () => {
    const view = await show([]);
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('history.emptyTitle')))).toBeTruthy();
    expect(view.queryByLabelText(t('history.nextA11yLabel'))).toBeNull();
    await view.unmount();
  });
});
