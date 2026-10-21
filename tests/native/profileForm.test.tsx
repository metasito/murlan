// tests/native/profileForm.test.tsx — the trend panels on the profile.
//
// The case that ships broken is the small one. A player three matches in must
// get something honest rather than an empty chart with axes, and a player with
// no matches at all must not be shown a panel about matches.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';
import * as i18n from '@/lib/i18n';

import type { AuthUser } from '@/context/AuthContext';
import { bannerLog } from './harness/bannerLog';
import { setWindow } from './harness/env';
import { queriesSettled, renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

const { shown, BannerLog } = bannerLog();
let user: AuthUser = { id: 'u1', username: 'Ana' };

const ProfileScreen = require('@/app/profile').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);


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

async function show(history: unknown[]) {
  const answer = (path: string, body: unknown) => route('GET', path, { body });
  answer('/api/stats/history', history);
  answer('/api/stats/me', {
    userId: 'u1',
    roundsPlayed: history.length,
    roundsWon: 1,
    matchesWon: 1,
    currentStreak: 1,
    bestStreak: 2,
    dailyStreak: 1,
    bombsPlayed: 0,
    updatedAt: new Date().toISOString(),
  });
  answer('/api/ratings/me', { season: '2026-08', rating: 1000, rounds: history.length, provisional: true });
  answer('/api/stats/achievements', []);
  answer('/api/replays', []);
  await setWindow({ width: 800, height: 600 });
  const view = await renderApp(
    <>
      <BannerLog />
      <ProfileScreen />
    </>,
    { user }
  );
  await queriesSettled();
  return view;
}

beforeEach(() => {
  user = { id: 'u1', username: 'Ana' };
  route('POST', '/api/auth/change-password', { body: { ok: true } });
  route('POST', '/api/auth/resend-verification', { body: { ok: true } });
});

afterEach(() => {
  jest.restoreAllMocks();
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

describe('the account controls', () => {
  it('confirm a changed password, and that other sessions were signed out', async () => {
    shown.length = 0;
    const view = await show([]);
    await fireEvent.press(view.getByLabelText(t('profile.changePasswordAction')));
    await fireEvent.changeText(view.getByTestId('input-current-password'), 'old-secret');
    await fireEvent.changeText(view.getByTestId('input-new-password'), 'new-secret');
    const saves = view.getAllByLabelText(t('common.save'));
    await fireEvent.press(saves[saves.length - 1]);

    await waitFor(() =>
      expect(shown).toContainEqual(expect.objectContaining({ message: t('profile.passwordChangedBody') }))
    );
    await view.unmount();
  });

  it('announce a rename error as a live region', async () => {
    const view = await show([]);
    await fireEvent.press(view.getByTestId('btn-rename'));
    await fireEvent.changeText(view.getByTestId('input-rename'), 'a');
    await fireEvent.press(view.getByLabelText(t('common.save')));

    expect(view.getByTestId('rename-error').props.accessibilityLiveRegion).toBe('polite');
    await view.unmount();
  });

  it('resend the verification mail in the active locale', async () => {
    user = { id: 'u1', username: 'Ana', email: 'ana@example.test', emailVerified: false };
    jest.spyOn(i18n, 'getLocale').mockReturnValue('it');
    const view = await show([]);
    await act(async () => {
      fireEvent.press(view.getByLabelText(t('profile.verifyEmailResend')));
    });

    expect(httpRequests().filter((r) => r.path === '/api/auth/resend-verification').map((r) => [r.method, r.body])).toEqual([
      ['POST', { locale: 'it' }],
    ]);
    await view.unmount();
  });
});
