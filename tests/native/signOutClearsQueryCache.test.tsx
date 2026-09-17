// tests/native/signOutClearsQueryCache.test.tsx — the cached lists belong to
// one account and their keys do not say whose, so signing out empties them,
// and nothing refetches against the session that just died.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act } from '@testing-library/react-native';

const mockSocket = {
  connected: false,
  active: true,
  on() {},
  off() {},
  emit() {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
};

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
  setSocketAuthFailureHandler: () => {},
}));

let mockUser: { id: string; username: string } | null = { id: 'u1', username: 'Ana' };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, logout: async () => {} }),
}));

const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

function tree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <NotificationProvider>
        <SocketProvider>
          <Text>{mockUser?.id ?? 'signed out'}</Text>
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

describe('signing out', () => {
  it('empties the query cache once the account is gone, and fetches nothing', async () => {
    const fetches: string[] = [];
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          queryFn: async ({ queryKey }) => {
            fetches.push(String(queryKey[0]));
            return [];
          },
        },
      },
    });
    qc.setQueryData(['/api/friends/invites'], []);
    qc.setQueryData(['/api/friends'], [{ id: 'f1' }]);

    const view = await render(tree(qc));
    expect(fetches).toEqual([]);

    mockUser = null;
    await act(async () => view.rerender(tree(qc)));

    expect(qc.getQueryCache().getAll()).toEqual([]);
    expect(fetches).toEqual([]);
    await view.unmount();
  });

  it('keeps the cache of a visitor who was never signed in', async () => {
    mockUser = null;
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, enabled: false } } });
    qc.setQueryData(['/api/leaderboard'], [{ id: 'p1' }]);

    const view = await render(tree(qc));

    expect(qc.getQueryData(['/api/leaderboard'])).toEqual([{ id: 'p1' }]);
    await view.unmount();
  });
});
