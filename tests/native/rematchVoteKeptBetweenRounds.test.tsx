// The server keeps the rematch tally across a between-hands `game:state` (a
// reclaimed seat re-broadcasts the table and sends no tally), so the client keeps it too.
import { describe, it, expect } from '@jest/globals';
import { renderAppHook } from './harness/renderApp';

import type { WireGameState } from '@/shared/protocol';
import { useOnlineMatch } from '@/context/onlineGameHooks';
import { aThreePlayed } from '../support/game';

const table = (roundOver: boolean): WireGameState => ({
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human', handCount: 0, vacated: false },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human', handCount: 0, vacated: false },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver,
  finishingOrder: roundOver ? ['player_0', 'player_1'] : [],
  firstPlayMade: true,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  viewerSeatIndex: 0,
  turnSecondsRemaining: 30,
});

describe('the rematch tally', () => {
  const mount = () =>
    renderAppHook(() => useOnlineMatch(), {
      user: { id: 'u1', username: 'Ana' },
      online: true,
      connected: true,
    });

  it('survives a game:state that leaves the table between hands', async () => {
    const view = await mount();
    await view.socket().deliver('game:state', table(true), () => {});
    await view.socket().deliver('game:vote_state', { votes: ['u1'], total: 2 });
    expect(view.result.current.rematchVoteState).toEqual({ votes: ['u1'], total: 2 });

    await view.socket().deliver('game:state', table(true), () => {});
    expect(view.result.current.rematchVoteState).toEqual({ votes: ['u1'], total: 2 });
    await view.unmount();
  });

  it('goes once the next round is dealt', async () => {
    const view = await mount();
    await view.socket().deliver('game:state', table(true), () => {});
    await view.socket().deliver('game:vote_state', { votes: ['u1'], total: 2 });

    await view.socket().deliver('game:state', table(false), () => {});
    expect(view.result.current.rematchVoteState).toBeNull();
    await view.unmount();
  });
});
