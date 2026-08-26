// tests/native/handBreakdown.test.tsx — the cases that ship broken.
//
// The breakdown reads four endpoints and one socket field, and every one of
// them is legitimately absent for some table: an offline or bot-majority hand
// is never written, a teams hand earns no rating, a second-game player's
// rating is provisional, and a hand can be rated and still move nobody. Each
// of those must read as itself rather than as a zero.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const { HandBreakdown } =
  require('@/components/HandBreakdown') as typeof import('@/components/HandBreakdown');

type Responses = Record<string, unknown>;

const RATED_HAND = {
  finishedAt: '2026-08-24T10:00:00.000Z',
  placement: 1,
  playerCount: 4,
  points: 3,
  ratingDelta: 12,
};

/**
 * A client whose fetcher answers from a fixed table, keyed exactly as
 * lib/query-client.ts builds its URL. A key with no entry rejects, which is
 * what an endpoint being down looks like.
 */
function clientWith(responses: Responses): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = (queryKey as string[]).join('/');
          if (!(url in responses)) throw new Error(`no stub for ${url}`);
          return responses[url];
        },
      },
    },
  });
}

const FULL: Responses = {
  '/api/stats/me': { currentStreak: 3, bestStreak: 5 },
  '/api/stats/history': [RATED_HAND],
  '/api/ratings/me': { rating: 1042, games: 20, provisional: false },
  '/api/replays': [],
};

async function renderBreakdown(
  responses: Responses,
  ratingDelta: number | null,
  mancheCanFollow = false
) {
  const view = await render(
    <QueryClientProvider client={clientWith(responses)}>
      <HandBreakdown myUserId="u1" ratingDelta={ratingDelta} mancheCanFollow={mancheCanFollow} />
    </QueryClientProvider>
  );
  // Every query resolves on a microtask; findBy* waits for the first paint
  // that follows them.
  await view.findByLabelText(/Ranked rating/);
  return view;
}

describe('the rating panel', () => {
  it('shows the change and the new rating for a rated hand', async () => {
    const view = await renderBreakdown(FULL, 12);
    expect(view.getByLabelText('Ranked rating: +12 → 1042')).toBeTruthy();
  });

  it('says the hand was not ranked rather than showing +0', async () => {
    const view = await renderBreakdown(
      { ...FULL, '/api/stats/history': [{ ...RATED_HAND, ratingDelta: null }] },
      null
    );
    expect(view.getByLabelText('Ranked rating: Not a ranked hand')).toBeTruthy();
    expect(view.queryByLabelText(/Ranked rating: \+?0/)).toBeNull();
  });

  // The floor for the assertion above: a rated hand that genuinely moved
  // nobody must still read as rated. Without the null/0 distinction both
  // cases would collapse into the same text and the test above would pass
  // for the wrong reason.
  it('a rated hand worth zero still reads as rated', async () => {
    const view = await renderBreakdown(FULL, 0);
    expect(view.getByLabelText('Ranked rating: 0 → 1042')).toBeTruthy();
  });

  it('falls back to the stored delta when the event is gone', async () => {
    const view = await renderBreakdown(FULL, null);
    expect(view.getByLabelText('Ranked rating: +12 → 1042')).toBeTruthy();
  });

  it('marks a provisional rating as provisional, with what is left to play', async () => {
    const view = await renderBreakdown(
      { ...FULL, '/api/ratings/me': { rating: 1012, games: 2, provisional: true } },
      12
    );
    expect(
      view.getByLabelText('Ranked rating: +12 → 1012. Provisional — 3 more ranked hands')
    ).toBeTruthy();
  });
});

describe('a hand nothing recorded', () => {
  const UNRECORDED: Responses = {
    '/api/stats/me': { currentStreak: 0, bestStreak: 0 },
    '/api/stats/history': [],
    '/api/ratings/me': { rating: 1000, games: 0, provisional: true },
    '/api/replays': [],
  };

  it('says so instead of showing a finish', async () => {
    const view = await renderBreakdown(UNRECORDED, null);
    expect(
      view.getByText('This hand was not recorded — too many bots at the table.')
    ).toBeTruthy();
    expect(view.queryByLabelText(/^Finish:/)).toBeNull();
  });

  it('offers no replay it does not have', async () => {
    const view = await renderBreakdown(UNRECORDED, null);
    expect(view.getByText('No replay for this hand')).toBeTruthy();
    expect(view.queryByLabelText('Open the replay of this hand')).toBeNull();
  });

  it('reads a broken streak as broken, not as a streak of zero', async () => {
    const view = await renderBreakdown(UNRECORDED, null);
    expect(view.getByLabelText('Win streak: No streak running')).toBeTruthy();
  });
});

describe('when an endpoint is down', () => {
  it('offers a retry rather than a page of zeroes', async () => {
    const down: Responses = { ...FULL };
    delete down['/api/stats/me'];
    const view = await render(
      <QueryClientProvider client={clientWith(down)}>
        <HandBreakdown myUserId="u1" ratingDelta={12} mancheCanFollow={false} />
      </QueryClientProvider>
    );
    expect(await view.findByLabelText('Retry loading the hand breakdown')).toBeTruthy();
    expect(view.queryByLabelText(/Ranked rating/)).toBeNull();
  });
});

// The overlay is up between manches too: the next one starts on a rematch
// vote, and until it is settled the seat is still the server's to auto-pass
// every 30s (server/gameTimers.ts AFK_TIMEOUT_MS).
describe('the replay button while another manche can still follow', () => {
  const WITH_REPLAY: Responses = {
    ...FULL,
    '/api/replays': [{ id: 'r1', finishedAt: '2026-08-24T10:00:00.000Z', gameMode: 'free_for_all', playerCount: 4 }],
    '/api/replays/r1': { id: 'r1', seats: [], moves: [], rankings: [] },
  };

  it('is not offered at all', async () => {
    const view = await renderBreakdown(WITH_REPLAY, 12, true);
    expect(view.queryByLabelText('Open the replay of this hand')).toBeNull();
    expect(view.queryByText('Watch the replay')).toBeNull();
  });

  it('says where the replay went instead of going silent', async () => {
    const view = await renderBreakdown(WITH_REPLAY, 12, true);
    expect(view.getByText('Watch it from your profile once the match is over')).toBeTruthy();
  });

  // A hand nothing recorded says so, whatever the room is doing: the deferral
  // names a replay that will never exist.
  it('does not promise a replay of a hand that was never recorded', async () => {
    const view = await renderBreakdown(FULL, 12, true);
    expect(view.getByText('No replay for this hand')).toBeTruthy();
    expect(view.queryByText('Watch it from your profile once the match is over')).toBeNull();
  });

  // The floor: the same breakdown with the seat released still offers it, so
  // the two assertions above cannot pass by never rendering a button at all.
  it('is offered once the seat is no longer live', async () => {
    const view = await renderBreakdown(WITH_REPLAY, 12, false);
    expect(view.getByLabelText('Open the replay of this hand')).toBeTruthy();
  });
});
