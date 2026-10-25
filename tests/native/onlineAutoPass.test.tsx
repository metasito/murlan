import { describe, it, expect, beforeEach } from '@jest/globals';
import React from 'react';
import { bannerLog } from './harness/bannerLog';
import { renderAppHook } from './harness/renderApp';

import type { WireGameState } from '@/shared/protocol';
import { useOnlineTable } from '@/context/onlineGameHooks';
import { aThreePlayed } from '../support/game';

const { shown, BannerLog } = bannerLog();

/** The name the server reads for its notice is the dealt seat's, `gameState.players[seat].name`. */
const DEALT: WireGameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human', handCount: 0, vacated: false },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human', handCount: 0, vacated: false },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  turn: '0',
  viewerSeatIndex: 0,
  turnSecondsRemaining: 30,
};

const afk = (username: string, code = 'PLAYER_AFK_AUTO_PASS') => ({
  type: 'afk',
  code,
  message: `${username} is inactive — passed automatically`,
  params: { username },
});

describe('the server auto-passing', () => {
  beforeEach(() => {
    shown.length = 0;
  });

  const mount = async () => {
    const view = await renderAppHook(() => useOnlineTable(), {
      user: { id: 'u1', username: 'Ana' },
      online: true,
      connected: true,
      wrap: (hook) => (
        <>
          <BannerLog />
          {hook}
        </>
      ),
    });
    await view.socket().deliver('game:state', DEALT, () => {});
    return view;
  };

  it('the viewer: the table slice counts it for the pass float, and no banner goes up', async () => {
    const view = await mount();
    const before = view.result.current.autoPassed;
    await view.socket().deliver('game:notification', afk('Ana'));
    expect(view.result.current.autoPassed).toBe((before ?? 0) + 1);
    expect(shown).toEqual([]);
    await view.unmount();
  });

  it('another seat, or an exchange made for the viewer: the banner as before, and no float', async () => {
    const view = await mount();
    const before = view.result.current.autoPassed;
    await view.socket().deliver('game:notification', afk('Besi'));
    await view.socket().deliver('game:notification', afk('Ana', 'PLAYER_AFK_AUTO_EXCHANGE'));
    expect(view.result.current.autoPassed).toBe(before);
    expect(shown).toHaveLength(2);
    await view.unmount();
  });
});
