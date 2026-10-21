// The vote deadline hands a still-connected player's seat to a bot (#1731): their own
// takeover is a state with a way back, everyone else's is only a notice.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';
import { renderAppHook } from './harness/renderApp';

import { OnlineGameProvider } from '@/context/OnlineGameContext';
import type { WireGameState } from '@/shared/protocol';
import { useOnlineGame } from './onlineSurface';
import { REJOIN_RETRY_DELAY_MS } from '@/context/useRejoin';
import { aThreePlayed } from '../support/game';

type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
const emitted: { event: string; payload?: unknown }[] = [];
const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  },
  off() {},
  once() {},
  timeout() {
    return mockSocket;
  },
  emit(event: string, payload?: unknown) {
    emitted.push({ event, payload });
  },
};
jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  useSocketConnection: () => mockSocket,
}));

const ROOM = {
  roomId: 'R1',
  code: 'R1',
  hostUserId: 'u1',
  status: 'in_progress' as const,
  gameMode: 'free_for_all' as const,
  maxPlayers: 2,
  players: [
    { seatIndex: 0, userId: 'u1', username: 'Ana' },
    { seatIndex: 1, userId: 'u2', username: 'Besi' },
  ],
};

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

const takeover = (userId: string, username: string, seatIndex: number) => ({
  userId,
  username,
  seatIndex,
  code: 'PLAYER_LEFT_BOT_TAKEOVER',
  params: { username },
  message: `${username} left`,
});

const deliver = (event: string, payload: unknown) =>
  act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });

const mount = async () => {
  const view = await renderAppHook(() => useOnlineGame(), {
    user: { id: 'u1', username: 'Ana' },
    wrap: (hook) => <OnlineGameProvider userId="u1">{hook}</OnlineGameProvider>,
  });
  await deliver('room:state', ROOM);
  await deliver('game:state', table(true));
  emitted.length = 0;
  return view;
};

const rejoins = () => emitted.filter((e) => e.event === 'game:rejoin');

describe('leftTable', () => {
  beforeEach(() => {
    listeners.clear();
    emitted.length = 0;
  });

  it("is set by a takeover naming the viewer's own userId", async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    expect(view.result.current.leftTable).toBe('vacated');
    await view.unmount();
  });

  it('is not set by a takeover naming someone else', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u2', 'Besi', 1));
    expect(view.result.current.leftTable).toBeNull();
    await view.unmount();
  });

  it('never reclaims on its own: game:rejoin goes out only on reclaimSeat', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    expect(rejoins()).toEqual([]);

    await act(async () => view.result.current.reclaimSeat());
    expect(rejoins()).toEqual([{ event: 'game:rejoin', payload: expect.objectContaining({ roomId: 'R1' }) }]);
    expect(view.result.current.leftTable).toBe('reclaiming');
    await view.unmount();
  });

  it('a second press while the reclaim is in flight sends nothing', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    await act(async () => view.result.current.reclaimSeat());
    await act(async () => view.result.current.reclaimSeat());
    expect(rejoins()).toHaveLength(1);
    await view.unmount();
  });

  it('a SERVER_ERROR reply retries through the same rejoin, still in flight', async () => {
    jest.useFakeTimers();
    try {
      const view = await mount();
      await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
      await act(async () => view.result.current.reclaimSeat());

      await deliver('game:rejoin_failed', { roomId: 'R1', code: 'SERVER_ERROR', message: 'blip' });
      expect(view.result.current.leftTable).toBe('reclaiming');
      await act(async () => {
        jest.advanceTimersByTime(REJOIN_RETRY_DELAY_MS);
      });
      expect(rejoins()).toHaveLength(2);
      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('is cleared by the game:state that seats the viewer again', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    await act(async () => view.result.current.reclaimSeat());

    await deliver('game:state', table(false));
    expect(view.result.current.leftTable).toBeNull();
    await view.unmount();
  });

  // The server sends a vacated player no game:state, only what goes to the whole room.
  it('holds through the room broadcasts that still reach a vacated player', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));

    await deliver('game:vote_state', { votes: ['u2'], total: 1 });
    await deliver('room:state', ROOM);
    await deliver('game:seat_bot_takeover', takeover('u2', 'Besi', 1));

    expect(view.result.current.leftTable).toBe('vacated');
    expect(view.result.current.mySeatIndex).toBe(0);
    await act(async () => view.result.current.reclaimSeat());
    expect(rejoins()).toEqual([{ event: 'game:rejoin', payload: expect.objectContaining({ roomId: 'R1' }) }]);
    await view.unmount();
  });

  // The rooms row reads `finished` between the rounds of a live match, and a room broadcast
  // (an invite declined, a friend removed) carries it to a player sitting on the results screen.
  it("still reclaims after a room:state reading 'finished' between rounds", async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    await deliver('room:state', { ...ROOM, status: 'finished' });

    await act(async () => view.result.current.reclaimSeat());
    expect(rejoins()).toEqual([{ event: 'game:rejoin', payload: expect.objectContaining({ roomId: 'R1' }) }]);
    expect(view.result.current.leftTable).toBe('reclaiming');
    await view.unmount();
  });

  it('a reconnect does not reclaim the seat for the player', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));

    await deliver('connect', undefined);
    expect(rejoins()).toEqual([]);
    expect(view.result.current.leftTable).toBe('vacated');
    await view.unmount();
  });

  it('is cleared by leaving the table', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));

    await act(async () => view.result.current.leaveRoom());
    expect(view.result.current.leftTable).toBeNull();
    await view.unmount();
  });

  it('a released seat after the reclaim goes through the rejoin teardown', async () => {
    const view = await mount();
    await deliver('game:seat_bot_takeover', takeover('u1', 'Ana', 0));
    await act(async () => view.result.current.reclaimSeat());

    await deliver('game:rejoin_failed', { roomId: 'R1', code: 'SEAT_RELEASED', message: 'released' });
    expect(view.result.current.rejoinFailed).toBe(true);
    expect(view.result.current.room).toBeNull();
    expect(view.result.current.leftTable).toBeNull();
    await view.unmount();
  });
});
