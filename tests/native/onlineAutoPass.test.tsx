import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import { OnlineGameProvider, type RoomState } from '@/context/OnlineGameContext';
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

const seen: { autoPassed?: number } = {};
function Probe() {
  seen.autoPassed = useOnlineTable().autoPassed;
  return null;
}

const ROOM: RoomState = {
  roomId: 'R1',
  code: 'R1',
  hostUserId: 'u1',
  status: 'playing',
  gameMode: 'free_for_all',
  visibility: 'private',
  maxPlayers: 2,
  players: [
    { seatIndex: 0, userId: 'u1', username: 'Ana' },
    { seatIndex: 1, userId: 'u2', username: 'Besi' },
  ],
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
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <OnlineGameProvider userId="u1">
          <Probe />
        </OnlineGameProvider>
      </QueryClientProvider>,
    );
    await deliver('room:state', ROOM);
    return view;
  };

  it('the viewer: the table slice counts it for the pass float, and no banner goes up', async () => {
    const view = await mount();
    const before = seen.autoPassed;
    await deliver('game:notification', afk('Ana'));
    expect(seen.autoPassed).toBe((before ?? 0) + 1);
    expect(mockShowNotification).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('another seat, or an exchange made for the viewer: the banner as before, and no float', async () => {
    const view = await mount();
    const before = seen.autoPassed;
    await deliver('game:notification', afk('Besi'));
    await deliver('game:notification', afk('Ana', 'PLAYER_AFK_AUTO_EXCHANGE'));
    expect(seen.autoPassed).toBe(before);
    expect(mockShowNotification).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
