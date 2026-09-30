import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { OnlineGameProvider, type GameStateBroadcast } from '@/context/OnlineGameContext';
import { useOnlineTable } from '@/context/onlineGameHooks';

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

const mockShowNotification = jest.fn();
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

/** The name the server reads for its notice is the dealt seat's, `gameState.players[seat].name`. */
const DEALT: GameStateBroadcast = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human', handCount: 0, vacated: false },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human', handCount: 0, vacated: false },
  ],
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
  viewerSeatIndex: 0,
  turnSecondsRemaining: 30,
};

const deliver = (event: string, payload: unknown) =>
  act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });
const afk = (username: string, code = 'PLAYER_AFK_AUTO_PASS') => ({
  type: 'afk',
  code,
  message: `${username} is inactive — passed automatically`,
  params: { username },
});

describe('the server auto-passing', () => {
  beforeEach(() => {
    listeners.clear();
    mockShowNotification.mockClear();
  });

  const mount = async () => {
    const view = await renderHook(() => useOnlineTable(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>
          <OnlineGameProvider userId="u1">{children}</OnlineGameProvider>
        </QueryClientProvider>
      ),
    });
    await deliver('game:state', DEALT);
    return view;
  };

  it('the viewer: the table slice counts it for the pass float, and no banner goes up', async () => {
    const view = await mount();
    const before = view.result.current.autoPassed;
    await deliver('game:notification', afk('Ana'));
    expect(view.result.current.autoPassed).toBe((before ?? 0) + 1);
    expect(mockShowNotification).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('another seat, or an exchange made for the viewer: the banner as before, and no float', async () => {
    const view = await mount();
    const before = view.result.current.autoPassed;
    await deliver('game:notification', afk('Besi'));
    await deliver('game:notification', afk('Ana', 'PLAYER_AFK_AUTO_EXCHANGE'));
    expect(view.result.current.autoPassed).toBe(before);
    expect(mockShowNotification).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
