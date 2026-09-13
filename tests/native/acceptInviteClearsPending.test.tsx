// tests/native/acceptInviteClearsPending.test.tsx — answering an invite answers
// it for both signals.
//
// `pendingInvite` says one arrived and `acceptedInvite` says the player said
// yes, and the online hub acts on each: the first prefills the code and asks,
// the second joins. Leaving the first up while setting the second puts the two
// on the same room at the same time — a code prompt over a join already in
// flight (#398).
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: true,
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
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const { SocketProvider, useSocket } =
  require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } =
  require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

const mount = () => {
  // One client per mount, as a fresh cache per test: created here rather than in
  // the wrapper's body, which React re-runs on every render.
  const client = new QueryClient();
  return renderHook(() => useSocket(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <SocketProvider>{children}</SocketProvider>
        </NotificationProvider>
      </QueryClientProvider>
    ),
  });
};

/** What the server sends when a friend invites this player to their table. */
const invite = async () => {
  await act(async () => {
    mockSocket.listeners.get('friend:invite')?.({ from: 'ana', roomCode: 'ABC123' });
  });
};

beforeEach(() => {
  mockSocket.listeners.clear();
});

describe('accepting an invite', () => {
  it('takes the arrival down with it', async () => {
    const { result, unmount } = await mount();
    await invite();
    expect(result.current.pendingInvite).not.toBeNull();

    await act(async () => result.current.acceptInvite('ABC123'));

    expect(result.current.acceptedInvite).toBe('ABC123');
    expect(result.current.pendingInvite).toBeNull();

    await unmount();
  });

  it('leaves an invite nobody answered standing', async () => {
    const { result, unmount } = await mount();
    await invite();

    expect(result.current.pendingInvite).toEqual({ from: 'ana', roomCode: 'ABC123' });
    expect(result.current.acceptedInvite).toBeNull();

    await unmount();
  });
});
