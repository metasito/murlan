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
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act } from '@testing-library/react-native';

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
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const { SocketProvider, useSocket } =
  require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } =
  require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

let ctx: ReturnType<typeof useSocket>;

function Probe() {
  ctx = useSocket();
  return <Text>probe</Text>;
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <SocketProvider>
          <Probe />
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );

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
    const r = await mount();
    await invite();
    expect(ctx.pendingInvite).not.toBeNull();

    await act(async () => ctx.acceptInvite('ABC123'));

    expect(ctx.acceptedInvite).toBe('ABC123');
    expect(ctx.pendingInvite).toBeNull();

    await r.unmount();
  });

  it('leaves an invite nobody answered standing', async () => {
    const r = await mount();
    await invite();

    expect(ctx.pendingInvite).toEqual({ from: 'ana', roomCode: 'ABC123' });
    expect(ctx.acceptedInvite).toBeNull();

    await r.unmount();
  });
});
