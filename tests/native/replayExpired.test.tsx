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

// Pulled in by <GameTable> through lib/sounds; the native module has no JS
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

let mockQueryResult: { data: unknown; isError: boolean; isLoading: boolean } = {
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
    mockQueryResult = { data: undefined, isError: true, isLoading: false };

    const view = await show();
    await act(async () => {});

    expect(view.getByText(t('replay.loadErrorTitle'))).toBeTruthy();
    expect(view.getByText(t('replay.loadErrorBody'))).toBeTruthy();
  });

  it('offers the way back out, and it works', async () => {
    mockQueryResult = { data: undefined, isError: true, isLoading: false };
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

    expect(view.queryByText(t('replay.loadErrorTitle'))).toBeNull();
    expect(view.getByLabelText(t('replay.loadingA11yLabel'))).toBeTruthy();
  });
});
