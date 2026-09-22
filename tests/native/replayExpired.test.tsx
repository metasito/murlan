// tests/native/replayExpired.test.tsx — replays live REPLAY_RETENTION_DAYS and
// then stop existing. A link to one, followed after that, must land on a
// readable dead end rather than a blank screen or a crash: the screen derives
// its whole table from a replay it does not have.
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

// Pulled in by <GameTable> through lib/device/sounds; the native module has no JS
// implementation to load here, and nothing in this test makes a sound.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: mockBack, push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'expired-replay-id' }),
}));

let mockQueryResult: { data: unknown; isError: boolean; isLoading: boolean; error?: unknown; refetch?: () => void } = {
  data: undefined,
  isError: false,
  isLoading: true,
};
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => mockQueryResult,
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';

const { ApiError } = require('@/lib/apiError') as typeof import('@/lib/apiError');
const GONE = new ApiError(404, { code: 'REPLAY_NOT_FOUND' }, '');

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

describe('a replay that no longer exists', () => {
  it('says so, instead of rendering a table it has no state for', async () => {
    mockQueryResult = { data: undefined, isError: true, isLoading: false, error: GONE };

    const view = await show();
    await act(async () => {});

    // By the group's label, not by its words: the block is one accessible
    // node with its own text hidden, so a text query cannot see inside it.
    expect(
      view.getByLabelText(`${t('replay.loadErrorTitle')}. ${t('replay.loadErrorBody')}`)
    ).toBeTruthy();
  });

  it('offers the way back out, and it works', async () => {
    mockQueryResult = { data: undefined, isError: true, isLoading: false, error: GONE };
    mockBack.mockClear();

    const view = await show();
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.back')));

    expect(mockBack).toHaveBeenCalled();
  });

  // The floor: the error branch must be reached because the query errored, not
  // because the screen renders that card whatever happens.
  it('shows the loading state, not the dead end, while the replay is still coming', async () => {
    mockQueryResult = { data: undefined, isError: false, isLoading: true };

    const view = await show();
    await act(async () => {});

    expect(view.queryByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeNull();
    expect(view.getByLabelText(t('replay.loadingA11yLabel'))).toBeTruthy();
  });

  // A replay is opened from a table, and a screen with no control of its own
  // leaves a spectator the rail's knob — the table's, and clipped (#347).
  it('offers the way out while the replay is still coming, too', async () => {
    mockQueryResult = { data: undefined, isError: false, isLoading: true };
    mockBack.mockClear();

    const view = await show();
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.back')));

    expect(mockBack).toHaveBeenCalled();
  });

  // A query can settle with nothing: no error, and no replay either.
  it('does not render a blank screen for a replay that arrived empty', async () => {
    mockQueryResult = { data: null, isError: false, isLoading: false };

    const view = await show();
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeTruthy();
    expect(view.getByLabelText(t('replay.back'))).toBeTruthy();
  });
});

describe('a replay that failed to load for any other reason', () => {
  it('offers a retry rather than calling the hand gone', async () => {
    const refetch = jest.fn();
    mockQueryResult = { data: undefined, isError: true, isLoading: false, error: new Error('Network request failed'), refetch };

    const view = await show();
    await act(async () => {});

    expect(view.queryByLabelText(new RegExp(t('replay.loadErrorBody')))).toBeNull();
    await fireEvent.press(view.getByLabelText(t('replay.retryA11yLabel')));
    expect(refetch).toHaveBeenCalled();
    await view.unmount();
  });
});

const REPLAY = {
  id: 'r1',
  finishedAt: '2026-08-20T10:00:00.000Z',
  gameMode: 'free_for_all',
  seats: [
    { seatIndex: 0, userId: 'u1', name: 'Ana' },
    { seatIndex: 1, userId: null, name: '' },
  ],
  rankings: [],
  moves: [
    { seat: 0, combo: { type: 'single', cards: [{ id: '3_spades', rank: '3', suit: 'spades', isJoker: false }], strength: 1 }, handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
  ],
};

describe('a stored replay', () => {
  it('lands on the unavailable card when a move lacks its hand counts', async () => {
    mockQueryResult = {
      data: { ...REPLAY, moves: [{ seat: 0, combo: null }] },
      isError: false,
      isLoading: false,
    };

    const view = await show();
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeTruthy();
    await view.unmount();
  });

  it('names a deleted player in the reader’s language', async () => {
    mockQueryResult = { data: REPLAY, isError: false, isLoading: false };

    const view = await show();
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.movesToggleA11yLabel')));

    expect(view.getAllByLabelText(new RegExp(t('replay.deletedPlayer'))).length).toBeGreaterThan(0);
    await view.unmount();
  });
});
