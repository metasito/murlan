// tests/native/roundEndRefreshesRatings.test.tsx — the rating after a finished hand is the round's own
// figure; tests/native/roundOverMarksStale.test.tsx holds what the round marks stale.
import { describe, it, expect } from '@jest/globals';
import { state } from '../support/game';
import { renderAppHook } from './harness/renderApp';
import { roundOver } from './harness/wire';
import { httpRequests } from './mocks/http';
import { useOnlineGame } from './onlineSurface';

describe('game:round_over', () => {
  it('takes the rating after the hand from game:over, not from a ladder read that can predate its write', async () => {
    const view = await renderAppHook(() => useOnlineGame(), { user: { id: 'u1', username: 'Ana' }, online: true });

    await view.socket().deliver(
      'game:round_over',
      roundOver(state(), {}, {
        matchOver: true,
        matchContinues: false,
        ratingDeltas: { u1: 14 },
        ratingsAfter: { u1: { rating: 1014, rounds: 3 } },
      })
    );

    expect(view.result.current.ratingsAfter).toEqual({ u1: { rating: 1014, rounds: 3 } });
    expect(httpRequests().filter((r) => r.path.startsWith('/api/ratings'))).toEqual([]);
    await view.unmount();
  });
});
