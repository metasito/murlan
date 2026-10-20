// tests/native/leaderboardScreen.test.tsx — the viewer's own rating on the
// ladder says when it is loading or failed, and a finished round refreshes it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' } }),
}));

const mockRefetchMe = jest.fn();
let mockMe: Record<string, unknown>;
let mockBoard: unknown[] = [];
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === '/api/ratings/me'
      ? { refetch: mockRefetchMe, ...mockMe }
      : { data: mockBoard, isLoading: false, isError: false, isSuccess: true, refetch: jest.fn() },
}));

const LeaderboardScreen = require('@/app/(online)/leaderboard').default as React.ComponentType;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LeaderboardScreen />
    </SafeAreaProvider>
  );

beforeEach(() => {
  mockRefetchMe.mockClear();
  mockBoard = [];
});

describe("the viewer's own rating", () => {
  it('says it is loading', async () => {
    mockMe = { data: undefined, isLoading: true, isError: false };
    const view = await show();
    expect(view.getByLabelText(locale['ladder.meLoadingA11yLabel'])).toBeTruthy();
    await view.unmount();
  });

  it('says it failed, and retries', async () => {
    mockMe = { data: undefined, isLoading: false, isError: true };
    const view = await show();
    await fireEvent.press(view.getByLabelText(locale['ladder.meRetryA11yLabel']));
    expect(mockRefetchMe).toHaveBeenCalled();
    await view.unmount();
  });

  it('keeps a rating it has when a refresh fails', async () => {
    mockMe = { data: { season: '2026-08', rating: 1234, rounds: 30, provisional: false }, isLoading: false, isError: true };
    const view = await show();
    expect(view.getByLabelText(/1234/)).toBeTruthy();
    expect(view.getByText(locale['common.refreshFailed'])).toBeTruthy();
    await view.unmount();
  });
});

describe('the ladder rows', () => {
  it("says which row is the viewer's own, in words", async () => {
    mockMe = { data: undefined, isLoading: false, isError: false };
    mockBoard = [
      { userId: 'u2', username: 'Bora', rank: 1, rating: 1500 },
      { userId: 'u1', username: 'Ana', rank: 2, rating: 1400 },
    ];
    const view = await show();
    expect(view.getByLabelText('2: Ana (you), 1400 points')).toBeTruthy();
    expect(view.getByLabelText('1: Bora, 1500 points')).toBeTruthy();
    await view.unmount();
  });
});
