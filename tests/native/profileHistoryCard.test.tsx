// tests/native/profileHistoryCard.test.tsx — the profile's one card of recent
// rounds: who was at the table, and which of them can still be watched.
//
// Its own file rather than a describe inside profileForm.test.tsx: this
// harness renders the whole profile screen, and a render left un-unmounted
// corrupts every later one in the same file (docs/agents/checks.md). Two
// suites over one screen is one suite too many to keep honest.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (...args: unknown[]) => mockPush(...args), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { translate, DEFAULT_LOCALE } from '@/shared/i18n';
import type { TranslationKey, TranslationParams } from '@/shared/i18n';

import { queryClient } from '@/lib/query-client';
import { setWindow } from './harness/env';
import { queriesSettled, renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

const ProfileScreen = require('@/app/profile').default as React.ComponentType;

const t = (key: string, params?: TranslationParams) =>
  translate(DEFAULT_LOCALE, key as TranslationKey, params);


interface Participant {
  name: string | null;
  bot: boolean;
}

const hand = (id: string, participants: Participant[], replayId: string | null) => ({
  id,
  userId: 'u1',
  finishedAt: new Date(Date.UTC(2026, 7, 19)).toISOString(),
  gameMode: 'free_for_all',
  placement: 2,
  playerCount: 3,
  points: 1,
  opponents: [],
  participants,
  replayId,
});

/** The label a watchable row carries, whatever summary it wraps. */
const WATCH_LABEL = new RegExp(t('history.watchA11yLabel', { summary: '' }));
/** How a row opens its list of seats, whatever the copy says. */
const WITH_PREFIX = new RegExp(t('history.with', { names: '' }));

/**
 * A row's seats are asserted on its accessibility label, not on its text: the
 * words themselves sit under `a11yHidden()` so the row reads as one node, and
 * the label is the only place a screen reader ever meets them.
 */
const seats = (names: string) =>
  new RegExp(
    t('history.with', { names }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

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
  await setWindow({ width: 800, height: 600 });
  const view = await renderApp(<ProfileScreen />, { user: { id: 'u1', username: 'Ana' } });
  await waitFor(() => expect(httpRequests().some((r) => r.path === '/api/stats/history')).toBe(true));
  await queriesSettled();
  return view;
}

beforeEach(() => {
  mockPush.mockClear();
});

describe('the recent-rounds card', () => {
  it('names who was at the table, bots and humans alike', async () => {
    const view = await show([
      hand('a', [{ name: 'Bea', bot: false }, { name: 'Luan', bot: true }], null),
    ]);
    await act(async () => {});

    expect(await view.findByLabelText(seats('Bea, Luan'))).toBeTruthy();
    await view.unmount();
  });

  // A seat whose name is gone is said to be gone. The bot and the deleted
  // account are different sentences because they are different facts, and the
  // server sends neither — it does not know the reader's language.
  it('names a seat it cannot resolve rather than inventing one', async () => {
    const view = await show([
      hand('a', [{ name: null, bot: true }, { name: null, bot: false }], null),
    ]);
    await act(async () => {});

    const names = `${t('history.botSeat')}, ${t('history.unknownSeat')}`;
    expect(await view.findByLabelText(seats(names))).toBeTruthy();
    await view.unmount();
  });

  it('says nothing about the table when the row carries no seats', async () => {
    const view = await show([hand('a', [], null)]);
    await act(async () => {});

    expect(view.queryByLabelText(WITH_PREFIX)).toBeNull();
    await view.unmount();
  });

  it('offers a watchable round as one labelled control, and plays it', async () => {
    const view = await show([hand('a', [{ name: 'Bea', bot: false }], 'r1')]);
    await act(async () => {});

    await fireEvent.press(await view.findByLabelText(WATCH_LABEL));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(online)/replay', params: { id: 'r1' } });
    await view.unmount();
  });

  // The floor: without this, the assertions above would pass just as well on a
  // card that offered every row, watchable or not.
  it('offers nothing on a round whose replay is gone', async () => {
    const view = await show([hand('a', [{ name: 'Bea', bot: false }], null)]);
    await act(async () => {});

    expect(view.queryByLabelText(WATCH_LABEL)).toBeNull();
    await view.unmount();
  });

  // Counted on the participants line, which only this card draws: the trend
  // panels above it render placements and points of their own.
  it('shows five rounds at most, however many are held', async () => {
    const view = await show(
      Array.from({ length: 8 }, (_, i) => hand(`h${i}`, [{ name: 'Bea', bot: false }], null))
    );
    await act(async () => {});

    expect(view.getAllByLabelText(seats('Bea'))).toHaveLength(5);
    await view.unmount();
  });
});

/**
 * The door out to the full list. It appears only when there is something
 * behind it — five rounds are all of them, and a door onto nothing is a dead
 * end the reader has to discover by walking through it.
 */
describe('the door out of the card', () => {
  it('is absent when the card already shows every round', async () => {
    const view = await show(
      Array.from({ length: 5 }, (_, i) => hand(`h${i}`, [], null))
    );
    await act(async () => {});

    expect(view.queryByLabelText(t('history.doorA11yLabel', { n: 5 }))).toBeNull();
    await view.unmount();
  });

  it('says how many rounds are behind it, and opens them', async () => {
    const view = await show(
      Array.from({ length: 8 }, (_, i) => hand(`h${i}`, [], null))
    );
    await act(async () => {});

    await fireEvent.press(
      await view.findByLabelText(t('history.doorA11yLabel', { n: 8 }))
    );
    expect(mockPush).toHaveBeenCalledWith('/(online)/history');
    await view.unmount();
  });
});

describe('a failed refresh of the card', () => {
  it('keeps the rounds it has and says only that it could not refresh', async () => {
    const view = await show([hand('a', [{ name: 'Bea', bot: false }], null)]);
    route('GET', '/api/stats/history', { status: 500 });
    await act(() => queryClient.refetchQueries({ queryKey: ['/api/stats/history'] }));
    await view.findByText(t('common.refreshFailed'));

    expect(await view.findByLabelText(seats('Bea'))).toBeTruthy();
    expect(view.queryByText(t('history.errorTitle'))).toBeNull();
    expect(view.getByText(t('common.refreshFailed'))).toBeTruthy();
    await view.unmount();
  });
});
