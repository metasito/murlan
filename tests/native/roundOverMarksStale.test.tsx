// A finished round marks every read it can have moved as stale: both ladder boards, the stats, the rating.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import { renderApp } from './harness/renderApp';
import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { queryClient } from '@/lib/query-client';
import { stale } from '@/lib/queries';

describe('game:round_over', () => {
  it('invalidates every read in stale.afterRound', async () => {
    const view = await renderApp(<OnlineGameProvider userId="u1">{null}</OnlineGameProvider>, {
      user: { id: 'u1', username: 'Ana' },
    });
    for (const key of stale.afterRound) queryClient.setQueryData(key, []);

    await act(async () =>
      view.socket().serverEmit('game:round_over', {
        finishingOrder: [],
        scores: [],
        matchOver: false,
        matchWinnerIds: [],
        ratingDeltas: {},
      } as never)
    );

    const left = stale.afterRound.filter((key) => !queryClient.getQueryState(key)?.isInvalidated);
    expect(left).toEqual([]);
  });
});
