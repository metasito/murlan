// tests/native/historyScreen.test.tsx — every round the player has, a page at
// a time. The property under test is that it pages: an endless scroll is the
// defect #678 exists to remove, so a list with no last page would be the same
// defect one screen along.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: mockBack, canGoBack: () => true, push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const mockScrollTo = jest.fn();
jest.mock('@/components/MenuLayout', () => ({
  MenuLayout: ({ children, scrollRef }: { children: unknown; scrollRef?: { current: unknown } }) => {
    if (scrollRef) scrollRef.current = { scrollTo: mockScrollTo };
    return children;
  },
}));

import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

import { queryClient } from '@/lib/query-client';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { route } from './mocks/http';

const HistoryScreen = require('@/app/(online)/history').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);

const HISTORY = '/api/stats/history';

/** Each round is given the seat name its index makes, so a row is identifiable. */
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

/** The screen once the server has answered `answer` for the player's rounds. */
async function show(answer: { status?: number; body?: unknown }) {
  route('GET', HISTORY, answer);
  await setWindow({ width: 800, height: 600 });
  const view = await renderApp(<HistoryScreen />, { user: { id: 'u1', username: 'Ana' } });
  // Idle alone also matches a query mounted but not yet fetching, which still shows the spinner.
  await waitFor(() => {
    const state = queryClient.getQueryState([HISTORY]);
    expect(state?.status).not.toBe('pending');
    expect(state?.fetchStatus).toBe('idle');
  });
  return view;
}
const rounds = (history: unknown[]) => show({ body: history });

/** A refresh that fails over the rounds already shown. */
async function refreshFails() {
  route('GET', HISTORY, { status: 500 });
  await act(() => queryClient.refetchQueries({ queryKey: [HISTORY] }));
}

beforeEach(() => {
  mockBack.mockClear();
});

describe('the full history screen', () => {
  it('shows one page of rounds and says which page it is', async () => {
    const view = await rounds(hands(23));
    await act(async () => {});

    expect(view.getByText(t('history.pageLabel', { page: 1, total: 3 }))).toBeTruthy();
    expect(view.getByLabelText(seats('Seat0'))).toBeTruthy();
    expect(view.queryByLabelText(seats('Seat10'))).toBeNull();
    await view.unmount();
  });

  it('walks forward and back through the pages', async () => {
    const view = await rounds(hands(23));
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
    const view = await rounds(hands(23));
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
    const view = await rounds(hands(4));
    await act(async () => {});

    expect(view.queryByLabelText(t('history.nextA11yLabel'))).toBeNull();
    expect(view.queryByLabelText(t('history.prevA11yLabel'))).toBeNull();
    expect(view.getByLabelText(seats('Seat3'))).toBeTruthy();
    await view.unmount();
  });

  it('says so when there are no rounds at all', async () => {
    const view = await rounds([]);
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('history.emptyTitle')))).toBeTruthy();
    expect(view.queryByLabelText(t('history.nextA11yLabel'))).toBeNull();
    await view.unmount();
  });
});

describe('a refresh that fails over rounds already shown', () => {
  it('keeps the rounds and offers a compact retry, not the full error', async () => {
    const view = await rounds(hands(4));
    await refreshFails();
    await view.findByText(t('common.refreshFailed'));

    expect(view.getByLabelText(seats('Seat0'))).toBeTruthy();
    expect(view.queryByText(t('history.errorTitle'))).toBeNull();
    expect(view.getByText(t('common.refreshFailed'))).toBeTruthy();
    expect(view.getByLabelText(t('history.retryA11yLabel'))).toBeTruthy();
    await view.unmount();
  });

  it('shows the full error when there is nothing to fall back on', async () => {
    const view = await show({ status: 500 });
    await act(async () => {});

    expect(view.getByText(t('history.errorTitle'))).toBeTruthy();
    expect(view.queryByText(t('common.refreshFailed'))).toBeNull();
    await view.unmount();
  });
});

describe('changing page', () => {
  it('scrolls back to the top of the list', async () => {
    const view = await rounds(hands(23));
    await act(async () => {});
    mockScrollTo.mockClear();

    await fireEvent.press(view.getByLabelText(t('history.nextA11yLabel')));
    expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
    await view.unmount();
  });
});
