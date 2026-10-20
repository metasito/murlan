// tests/native/replayStaleRefresh.test.tsx — a replay on screen stays on screen
// when a background refresh fails, and says only that it could not refresh.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));

const card = (rank: string, suit: string) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false });
const combo = (type: string, cards: ReturnType<typeof card>[]) => ({ type, cards, strength: 1 });

const mockReplay = {
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

let mockQuery: Record<string, unknown>;
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<object>('@tanstack/react-query'),
  useQuery: () => mockQuery,
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { en as locale } from '@/locales/en';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';

const ReplayScreen = require('@/app/(online)/replay').default as React.ComponentType;

const t = (key: string) => translate(DEFAULT_LOCALE, key as TranslationKey);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 400 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReplayScreen />
    </SafeAreaProvider>
  );

describe('a failed refresh of a replay', () => {
  it('keeps the table and the transport, with a quiet note above them', async () => {
    mockQuery = { data: mockReplay, isError: true, isLoading: false, refetch: jest.fn() };
    const view = await show();
    expect(view.getByText(locale['common.refreshFailed'])).toBeTruthy();
    expect(view.getByLabelText(t('replay.nextA11yLabel'))).toBeTruthy();
    expect(view.queryByText(locale['replay.loadFailedTitle'])).toBeNull();
    await view.unmount();
  });

  it('with no replay to show, is the full error with a retry', async () => {
    const refetch = jest.fn();
    mockQuery = { data: undefined, isError: true, isLoading: false, refetch };
    const view = await show();
    expect(view.queryByText(locale['common.refreshFailed'])).toBeNull();
    await fireEvent.press(view.getByLabelText(t('replay.retryA11yLabel')));
    expect(refetch).toHaveBeenCalled();
    await view.unmount();
  });
});
