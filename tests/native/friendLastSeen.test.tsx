// tests/native/friendLastSeen.test.tsx — a friend:status offline event carries
// the disconnect time the server just wrote. The friends row reads its time
// from the ["/api/friends"] cache, so an event that updates only onlineIds
// leaves the row showing whatever the last fetch returned — which, taken while
// the friend was still online, is their *previous* disconnect.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act } from '@testing-library/react-native';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: false,
  active: true,
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
  },
  off() {},
  emit() {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
};

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

const PREVIOUS_DISCONNECT = '2026-08-20T10:00:00.000Z';
const JUST_NOW = '2026-08-20T10:11:00.000Z';

function friendsIn(qc: QueryClient) {
  return qc.getQueryData(['/api/friends']) as { id: string; username: string; lastSeen: string | null }[];
}

describe('friend:status carries the time the row shows', () => {
  let qc: QueryClient;

  beforeEach(async () => {
    mockSocket.connected = false;
    mockSocket.listeners.clear();
    qc = new QueryClient();
    qc.setQueryData(['/api/friends'], [
      { id: 'f1', username: 'Ben', lastSeen: PREVIOUS_DISCONNECT },
      { id: 'f2', username: 'Drita', lastSeen: PREVIOUS_DISCONNECT },
    ]);
    await render(
      <QueryClientProvider client={qc}>
        <NotificationProvider>
          <SocketProvider><Text>probe</Text></SocketProvider>
        </NotificationProvider>
      </QueryClientProvider>
    );
  });

  it('writes the disconnect time the event carries into the friends cache', async () => {
    const onFriendStatus = mockSocket.listeners.get('friend:status');
    expect(onFriendStatus).toBeDefined();

    await act(async () => {
      onFriendStatus!({ userId: 'f1', online: false, lastSeen: JUST_NOW });
    });

    expect(friendsIn(qc).find((f) => f.id === 'f1')!.lastSeen).toBe(JUST_NOW);
  });

  it('moves no one else, and keeps the rest of the row intact', async () => {
    const onFriendStatus = mockSocket.listeners.get('friend:status');

    await act(async () => {
      onFriendStatus!({ userId: 'f1', online: false, lastSeen: JUST_NOW });
    });

    const other = friendsIn(qc).find((f) => f.id === 'f2')!;
    expect(other.lastSeen).toBe(PREVIOUS_DISCONNECT);
    expect(friendsIn(qc).find((f) => f.id === 'f1')!.username).toBe('Ben');
  });

  it('leaves the cache alone when the event carries no time', async () => {
    const onFriendStatus = mockSocket.listeners.get('friend:status');

    await act(async () => {
      onFriendStatus!({ userId: 'f1', online: true });
    });

    expect(friendsIn(qc).find((f) => f.id === 'f1')!.lastSeen).toBe(PREVIOUS_DISCONNECT);
  });
});
