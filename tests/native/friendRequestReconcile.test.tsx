// tests/native/friendRequestReconcile.test.tsx — reconnecting re-reads what
// arrived while you were gone.
//
// `emitToUser` (server/socket.ts) looks the recipient up in `userSocketMap`
// and returns silently when they are not connected: no queue, no retry. That
// emit is the only thing that invalidates the friend-request queries, so a
// request sent to someone who is offline reaches their database row and
// nothing else — they cannot accept it because they never see it, and the
// sender cannot re-send because `hasPendingRequest` already matches the pair.
//
// The row is the truth and the client only has to ask again. Connecting is
// when it must ask: the socket already re-reads the online list there.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: false,
  active: true,
  listeners: new Map<string, Listener>(),
  emitted: [] as string[],
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
  },
  off() {},
  emit(event: string) {
    this.emitted.push(event);
  },
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

/** The queries whose rows can change while the socket is down. */
const PENDING_KEYS = ['/api/friends/requests', '/api/friends/sent', '/api/friends'];

async function harness() {
  const qc = new QueryClient();
  const invalidated: string[] = [];
  const realInvalidate = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    const key = filters?.queryKey?.[0];
    if (typeof key === 'string') invalidated.push(key);
    return realInvalidate(filters as never);
  }) as typeof qc.invalidateQueries;

  await render(
    <QueryClientProvider client={qc}>
      <NotificationProvider>
        <SocketProvider>
          <Text>probe</Text>
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
  return { invalidated };
}

describe('a reconnect reconciles what arrived while the socket was down', () => {
  beforeEach(() => {
    mockSocket.connected = false;
    mockSocket.listeners.clear();
    mockSocket.emitted = [];
  });

  it('re-reads the pending friend requests on connect', async () => {
    const { invalidated } = await harness();

    await act(async () => {
      mockSocket.listeners.get('connect')?.();
    });

    // Named one by one rather than as a set, so a failure says which query
    // stopped being re-read: a request that arrived while this client was
    // offline is invisible until it asks, and nobody pushes it a second time.
    for (const key of PENDING_KEYS) expect(invalidated).toContain(key);
  });

  // The other half of the same silent drop: being accepted while you are
  // offline leaves you looking at a friends list that never gained them.
  it('re-reads the friends list too, since an accept is dropped the same way', async () => {
    const { invalidated } = await harness();

    await act(async () => {
      mockSocket.listeners.get('connect')?.();
    });

    expect(invalidated).toContain('/api/friends');
  });

  // Presence is genuinely ephemeral — that this still happens is what says the
  // re-read was added beside the existing behaviour rather than in place of it.
  it('still asks who is online', async () => {
    await harness();

    await act(async () => {
      mockSocket.listeners.get('connect')?.();
    });

    expect(mockSocket.emitted).toContain('friend:get_online_list');
  });
});
