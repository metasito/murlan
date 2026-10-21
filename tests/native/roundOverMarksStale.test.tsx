// A finished round marks every read it can have moved as stale: both ladder boards, the stats, the rating.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import { renderApp } from './harness/renderApp';
import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { queryClient } from '@/lib/query-client';
import { queryKey } from '@/lib/queries';
import type { RoundOverPayload } from '@/lib/game/matchState';

const MOVED_BY_A_ROUND = [
  queryKey('stats/me'),
  queryKey('stats/history'),
  queryKey('stats/achievements'),
  queryKey('ratings/me'),
  queryKey('ratings/leaderboard'),
  queryKey('ratings/leaderboard/friends'),
];

describe('game:round_over', () => {
  it('invalidates the stats, the rating and both ladder boards', async () => {
    const view = await renderApp(<OnlineGameProvider userId="u1">{null}</OnlineGameProvider>, {
      user: { id: 'u1', username: 'Ana' },
    });
    for (const key of MOVED_BY_A_ROUND) queryClient.setQueryData(key, []);

    await act(async () =>
      view.socket().serverEmit('game:round_over', {
        finishingOrder: [],
        scores: [],
        matchTarget: 0,
        matchLength: 'single',
        roundsPlayed: 1,
        matchOver: false,
        matchWinnerIds: [],
        matchContinues: false,
        isDraw: false,
        ratingDeltas: {},
        ratingsAfter: {},
        recorded: true,
        voided: false,
      } satisfies RoundOverPayload)
    );

    const left = MOVED_BY_A_ROUND.filter((key) => !queryClient.getQueryState(key)?.isInvalidated);
    expect(left).toEqual([]);
  });
});
