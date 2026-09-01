// tests/native/profileForm.test.tsx — the trend panels on the profile.
//
// The case that ships broken is the small one. A player three matches in must
// get something honest rather than an empty chart with axes, and a player with
// no matches at all must not be shown a panel about matches.
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

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
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
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

import { SettingsProvider } from '@/context/SettingsContext';

const ProfileScreen = require('@/app/profile').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 600 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const match = (id: string, daysAgo: number, placement: number, playerCount = 4) => ({
  id,
  userId: 'u1',
  finishedAt: new Date(Date.UTC(2026, 7, 20 - daysAgo)).toISOString(),
  gameMode: 'free_for_all',
  placement,
  playerCount,
  points: 3,
  opponents: [],
  participants: [],
  replayId: null,
});

function show(history: unknown[]) {
  mockData['/api/stats/history'] = history;
  mockData['/api/stats/me'] = {
    userId: 'u1',
    gamesPlayed: history.length,
    gamesWon: 1,
    matchesWon: 1,
    currentStreak: 1,
    bestStreak: 2,
    dailyStreak: 1,
    bombsPlayed: 0,
    updatedAt: new Date().toISOString(),
  };
  mockData['/api/ratings/me'] = { season: '2026-08', rating: 1000, games: history.length, provisional: true };
  mockData['/api/stats/achievements'] = [];
  mockData['/api/replays'] = [];
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsProvider>
        <ProfileScreen />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  for (const key of Object.keys(mockData)) delete mockData[key];
});

describe('the profile trend panels', () => {
  it('say something honest on three matches, not an empty chart', async () => {
    const view = await show([match('a', 1, 1), match('b', 2, 3), match('c', 3, 2)]);
    await act(async () => {});

    expect(view.getByText(t('profile.formTitle'))).toBeTruthy();
    // The sample is named rather than implied — three matches is three, not "recent".
    expect(view.getByText(t('profile.formSampleNote', { n: 3 }))).toBeTruthy();
    expect(view.getByText(t('profile.formDistributionLabel'))).toBeTruthy();
  });

  // The floor: everything above would pass just as well if the panel rendered
  // unconditionally, which is exactly the empty-chart-with-axes this must avoid.
  it('are absent entirely for a player with no matches', async () => {
    const view = await show([]);
    await act(async () => {});

    expect(view.queryByText(t('profile.formTitle'))).toBeNull();
    expect(view.queryByText(t('profile.formDistributionLabel'))).toBeNull();
  });

  it('split by table size, so one strong seat count is visible', async () => {
    const view = await show([
      match('a', 1, 1, 3),
      match('b', 2, 2, 3),
      match('c', 3, 4, 4),
    ]);
    await act(async () => {});

    expect(view.getByText(t('profile.formByPlayersLabel'))).toBeTruthy();
    expect(view.getByLabelText(t('profile.formPlacementRowA11yLabel', {
      position: t('result.position1'),
      n: 1,
      total: 3,
    }))).toBeTruthy();
  });
});
