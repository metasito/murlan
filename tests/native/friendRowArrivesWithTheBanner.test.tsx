// tests/native/friendRowArrivesWithTheBanner.test.tsx — one event moves every
// surface on the same frame.
//
// Invalidating a query only *starts* a round trip, so a client that had nothing
// but the invalidation showed the banner instantly and the badge seconds later
// (#827). The server now sends the row the fetch would have returned, and the
// handler seats it in the cache before the fetch is asked for at all.
//
// What this pins is the cache, read back — not that `setQueryData` was called.
// A push that names the wrong key, builds the wrong shape, or drops the row on
// a list that already has entries is invisible to a spy and plain here.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import type { FriendInfo, FriendRequestInfo } from '@/lib/wire';

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

// The real provider schedules a dismissal timer per banner, which outlives the
// test and stops jest exiting. Capturing instead also makes 'the banner still
// arrives' something this file can assert rather than assume.
const mockShown: { type: string; message: string }[] = [];
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({
    showNotification: (n: { type: string; message: string }) => {
      mockShown.push(n);
    },
  }),
}));

const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');

const REQUEST: FriendRequestInfo = {
  id: 'req-1',
  username: 'Blerim',
  createdAt: '2026-09-02T10:00:00.000Z',
};

const FRIEND: FriendInfo = { id: 'u2', username: 'Blerim', lastSeen: null };

async function harness() {
  // No `queryFn` anywhere: every assertion below is about what the push put in
  // the cache, and a fetch that could answer would be answering off the slow
  // path this change exists to get ahead of. `retry: false` is what keeps the
  // one query `SocketProvider` mounts from backing off for the whole test.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.getQueryCache().config.onError = () => {};
  const view = await render(
    <QueryClientProvider client={qc}>
      <SocketProvider>
        <Text>probe</Text>
      </SocketProvider>
    </QueryClientProvider>
  );
  return { qc, view };
}

const fire = (event: string, payload: unknown) =>
  act(async () => {
    mockSocket.listeners.get(event)?.(payload);
  });

describe('a friend request carries its row', () => {
  beforeEach(() => {
    mockSocket.connected = false;
    mockSocket.listeners.clear();
    mockSocket.emitted = [];
    mockShown.length = 0;
  });

  it('seats the pushed request in the cache the badge and the list both read', async () => {
    const { qc, view } = await harness();

    await fire('friend:request_incoming', { from: 'Blerim', request: REQUEST });

    expect(qc.getQueryData(['/api/friends/requests'])).toEqual([REQUEST]);

    await view.unmount();
  });

  it('adds it to the rows already there rather than replacing them', async () => {
    const { qc, view } = await harness();
    const existing: FriendRequestInfo = {
      id: 'req-0',
      username: 'Dea',
      createdAt: '2026-09-01T10:00:00.000Z',
    };
    qc.setQueryData(['/api/friends/requests'], [existing]);

    await fire('friend:request_incoming', { from: 'Blerim', request: REQUEST });

    expect(qc.getQueryData(['/api/friends/requests'])).toEqual([existing, REQUEST]);

    await view.unmount();
  });

  it('does not seat the same request twice when the event repeats', async () => {
    const { qc, view } = await harness();

    await fire('friend:request_incoming', { from: 'Blerim', request: REQUEST });
    await fire('friend:request_incoming', { from: 'Blerim', request: REQUEST });

    expect(qc.getQueryData(['/api/friends/requests'])).toEqual([REQUEST]);

    await view.unmount();
  });

  // An older client-server pair, or a row created by a path that emits nothing:
  // the announcement still has to arrive and the fetch still has to be started.
  it('still announces when no row travels with the event', async () => {
    const { qc, view } = await harness();

    await fire('friend:request_incoming', { from: 'Blerim' });

    expect(mockShown.map((n) => n.type)).toEqual(['friend_request']);
    expect(qc.getQueryData(['/api/friends/requests'])).toBeUndefined();

    await view.unmount();
  });
});

// The same lag, the same remedy — and by the same mechanism, so a fix to one is
// a fix to both rather than a second copy that can drift.
describe('an acceptance carries its row too', () => {
  beforeEach(() => {
    mockSocket.connected = false;
    mockSocket.listeners.clear();
    mockSocket.emitted = [];
    mockShown.length = 0;
  });

  it('seats the new friend in the friends list', async () => {
    const { qc, view } = await harness();

    await fire('friend:request_accepted', { by: 'Blerim', friend: FRIEND });

    expect(qc.getQueryData(['/api/friends'])).toEqual([FRIEND]);

    await view.unmount();
  });

  it('keeps the friends already listed', async () => {
    const { qc, view } = await harness();
    const existing: FriendInfo = { id: 'u3', username: 'Dea', lastSeen: null };
    qc.setQueryData(['/api/friends'], [existing]);

    await fire('friend:request_accepted', { by: 'Blerim', friend: FRIEND });

    expect(qc.getQueryData(['/api/friends'])).toEqual([existing, FRIEND]);

    await view.unmount();
  });

  it('survives an event with no row', async () => {
    const { qc, view } = await harness();

    await fire('friend:request_accepted', { by: 'Blerim' });

    expect(mockShown.map((n) => n.type)).toEqual(['friend_accepted']);
    expect(qc.getQueryData(['/api/friends'])).toBeUndefined();

    await view.unmount();
  });
});
