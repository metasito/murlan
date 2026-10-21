// tests/native/replayExpired.test.tsx — replays live REPLAY_RETENTION_DAYS and
// then stop existing. A link to one, followed after that, must land on a
// readable dead end rather than a blank screen or a crash: the screen derives
// its whole table from a replay it does not have.
import { afterEach, describe, it, expect, jest } from '@jest/globals';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'expired-replay-id' }),
}));

import React from 'react';
import { fireEvent, act, waitFor } from '@testing-library/react-native';
import { queryClient } from '@/lib/query-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey } from '@/shared/i18n';
import { queriesSettled, renderApp } from './harness/renderApp';
import { httpRequests, route, unreachable, type HttpReply } from './mocks/http';

const GONE: HttpReply = { status: 404, body: { code: 'REPLAY_NOT_FOUND' } };

const ReplayScreen = require('@/app/(online)/replay').default as React.ComponentType;

const t = (key: string) => translate(DEFAULT_LOCALE, key as TranslationKey);

const METRICS = {
  frame: { x: 0, y: 0, width: 800, height: 400 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** A replay request the server is still answering; released when the test ends. */
const held: ((reply: HttpReply) => void)[] = [];
const stillComing = () => () => new Promise<HttpReply>((resolve) => held.push(resolve));
afterEach(() => held.splice(0).forEach((release) => release({ status: 404, body: { code: 'REPLAY_NOT_FOUND' } })));

const show = async (answer: Parameters<typeof route>[2], { settled = true } = {}) => {
  route('GET', '/api/replays/expired-replay-id', answer);
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReplayScreen />
    </SafeAreaProvider>,
    { user: { id: 'u1', username: 'Ana' } }
  );
  if (settled) await queriesSettled();
  else await waitFor(() => expect(queryClient.isFetching()).toBe(1));
  return view;
};

describe('a replay that no longer exists', () => {
  it('says so, instead of rendering a table it has no state for', async () => {
    const view = await show(GONE);
    await act(async () => {});

    // By the group's label, not by its words: the block is one accessible
    // node with its own text hidden, so a text query cannot see inside it.
    expect(
      view.getByLabelText(`${t('replay.loadErrorTitle')}. ${t('replay.loadErrorBody')}`)
    ).toBeTruthy();
  });

  it('offers the way back out, and it works', async () => {
    mockBack.mockClear();

    const view = await show(GONE);
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.back')));

    expect(mockBack).toHaveBeenCalled();
  });

  // The floor: the error branch must be reached because the query errored, not
  // because the screen renders that card whatever happens.
  it('shows the loading state, not the dead end, while the replay is still coming', async () => {
    const view = await show(stillComing(), { settled: false });
    await act(async () => {});

    expect(view.queryByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeNull();
    expect(view.getByLabelText(t('replay.loadingA11yLabel'))).toBeTruthy();
  });

  // A replay is opened from a table, and a screen with no control of its own
  // leaves a spectator the rail's knob — the table's, and clipped (#347).
  it('offers the way out while the replay is still coming, too', async () => {
    mockBack.mockClear();

    const view = await show(stillComing(), { settled: false });
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.back')));

    expect(mockBack).toHaveBeenCalled();
  });

  // A query can settle with nothing: no error, and no replay either.
  it('does not render a blank screen for a replay that arrived empty', async () => {
    const view = await show({ body: null });
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeTruthy();
    expect(view.getByLabelText(t('replay.back'))).toBeTruthy();
  });
});

describe('a replay that failed to load for any other reason', () => {
  it('offers a retry rather than calling the hand gone', async () => {
    const view = await show(unreachable);
    await act(async () => {});

    expect(view.queryByLabelText(new RegExp(t('replay.loadErrorBody')))).toBeNull();
    const asked = () => httpRequests().filter((r) => r.path === '/api/replays/expired-replay-id').length;
    const before = asked();
    await fireEvent.press(view.getByLabelText(t('replay.retryA11yLabel')));
    expect(asked()).toBe(before + 1);
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
  finishingOrder: [],
  moves: [
    { seat: 0, combo: { type: 'single', cards: [{ id: '3_spades', rank: '3', suit: 'spades', isJoker: false }], strength: 1 }, handCounts: [2, 3] },
    { seat: 1, combo: null, handCounts: [2, 3] },
  ],
};

describe('a stored replay', () => {
  it('lands on the unavailable card when a move lacks its hand counts', async () => {
    const view = await show({ body: { ...REPLAY, moves: [{ seat: 0, combo: null }] } });
    await act(async () => {});

    expect(view.getByLabelText(new RegExp(t('replay.loadErrorTitle')))).toBeTruthy();
    await view.unmount();
  });

  it('names a deleted player in the reader’s language', async () => {
    const view = await show({ body: REPLAY });
    await act(async () => {});
    await fireEvent.press(view.getByLabelText(t('replay.movesToggleA11yLabel')));

    expect(view.getAllByLabelText(new RegExp(t('replay.deletedPlayer'))).length).toBeGreaterThan(0);
    await view.unmount();
  });
});
