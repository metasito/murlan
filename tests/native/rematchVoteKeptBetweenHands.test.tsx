// The server keeps the rematch tally across a between-hands `game:state` (a
// reclaimed seat re-broadcasts the table and sends no tally), so the client keeps it too.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { OnlineGameProvider, type GameStateBroadcast } from '@/context/OnlineGameContext';
import { useOnlineMatch } from '@/context/onlineGameHooks';

type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
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
  emit() {},
};
jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
}));

const table = (gameOver: boolean): GameStateBroadcast => ({
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human', handCount: 0, vacated: false },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human', handCount: 0, vacated: false },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver,
  rankings: gameOver ? ['player_0', 'player_1'] : [],
  firstPlayMade: true,
  viewerSeatIndex: 0,
});

const deliver = (event: string, payload: unknown) =>
  act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });

describe('the rematch tally', () => {
  beforeEach(() => listeners.clear());

  const mount = () =>
    renderHook(() => useOnlineMatch(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>
          <OnlineGameProvider userId="u1">{children}</OnlineGameProvider>
        </QueryClientProvider>
      ),
    });

  it('survives a game:state that leaves the table between hands', async () => {
    const view = await mount();
    await deliver('game:state', table(true));
    await deliver('game:vote_state', { votes: ['u1'], total: 2 });
    expect(view.result.current.rematchVoteState).toEqual({ votes: ['u1'], total: 2 });

    await deliver('game:state', table(true));
    expect(view.result.current.rematchVoteState).toEqual({ votes: ['u1'], total: 2 });
    await view.unmount();
  });

  it('goes once the next manche is dealt', async () => {
    const view = await mount();
    await deliver('game:state', table(true));
    await deliver('game:vote_state', { votes: ['u1'], total: 2 });

    await deliver('game:state', table(false));
    expect(view.result.current.rematchVoteState).toBeNull();
    await view.unmount();
  });
});
