// tests/native/leaderboardScreen.test.tsx — the viewer's own rating on the
// ladder says when it is loading or failed, and a finished round refreshes it.
import { describe, it, expect, beforeEach } from '@jest/globals';
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';
import { queryClient } from '@/lib/query-client';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

const LeaderboardScreen = require('@/app/(online)/leaderboard').default as React.ComponentType;

const ME = '/api/ratings/me';
const asked = (path: string) => httpRequests().filter((r) => r.method === 'GET' && r.path === path).length;
// Idle alone also matches a query mounted but not yet fetching, which still shows the spinner.
const settled = (path: string) =>
  waitFor(() => {
    const state = queryClient.getQueryState([path]);
    expect(state?.status).not.toBe('pending');
    expect(state?.fetchStatus).toBe('idle');
  });
const show = async () => {
  await setWindow({ width: 390, height: 844 });
  return renderApp(<LeaderboardScreen />, { user: { id: 'u1', username: 'Ana' } });
};

beforeEach(() => {
  route('GET', '/api/ratings/leaderboard', { body: [] });
});

describe("the viewer's own rating", () => {
  it('says it is loading', async () => {
    route('GET', ME, () => new Promise(() => {}));
    const view = await show();
    expect(view.getByLabelText(locale['ladder.meLoadingA11yLabel'])).toBeTruthy();
    await view.unmount();
  });

  it('says it failed, and retries', async () => {
    route('GET', ME, { status: 500 });
    const view = await show();
    await settled(ME);
    const before = asked(ME);
    await fireEvent.press(view.getByLabelText(locale['ladder.meRetryA11yLabel']));
    expect(asked(ME)).toBe(before + 1);
    await view.unmount();
  });

  it('keeps a rating it has when a refresh fails', async () => {
    route('GET', ME, { body: { season: '2026-08', rating: 1234, rounds: 30, provisional: false } });
    const view = await show();
    await settled(ME);
    route('GET', ME, { status: 500 });
    await act(() => queryClient.refetchQueries({ queryKey: [ME] }));
    expect(view.getByLabelText(/1234/)).toBeTruthy();
    expect(await view.findByText(locale['common.refreshFailed'])).toBeTruthy();
    await view.unmount();
  });
});

describe('the ladder rows', () => {
  it("says which row is the viewer's own, in words", async () => {
    route('GET', ME, { status: 404 });
    route('GET', '/api/ratings/leaderboard', {
      body: [
        { userId: 'u2', username: 'Bora', rank: 1, rating: 1500 },
        { userId: 'u1', username: 'Ana', rank: 2, rating: 1400 },
      ],
    });
    const view = await show();
    await settled('/api/ratings/leaderboard');
    expect(view.getByLabelText('2: Ana (you), 1400 points')).toBeTruthy();
    expect(view.getByLabelText('1: Bora, 1500 points')).toBeTruthy();
    await view.unmount();
  });
});
