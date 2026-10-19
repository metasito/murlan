// tests/native/inviteSend.test.tsx — `useInvites().send` is the one way a
// screen invites a friend, and it tells the player itself when the invite did
// not go: a refusal in the server's words, silence as a request that never
// arrived.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';

type Ack = (err: unknown, reply?: { ok: boolean; code?: string }) => void;
const mockAcks: { event: string; payload: unknown; ack: Ack }[] = [];

const mockSocket = {
  connected: false,
  active: true,
  on() {},
  off() {},
  emit() {},
  timeout: () => ({
    emit: (event: string, payload: unknown, ack: Ack) => mockAcks.push({ event, payload, ack }),
  }),
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
};

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const mockShowNotification = jest.fn();
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

const { SocketProvider, useInvites } =
  require('@/context/SocketContext') as typeof import('@/context/SocketContext');

const mount = () => {
  const client = new QueryClient();
  return renderHook(() => useInvites(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <SocketProvider>{children}</SocketProvider>
      </QueryClientProvider>
    ),
  });
};

async function sendAnswered(...answer: Parameters<Ack>) {
  const { result, unmount } = await mount();
  let sent: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    sent = result.current.send('f1', 'ABC123');
  });
  expect(mockAcks[0].event).toBe('friend:invite');
  expect(mockAcks[0].payload).toEqual({ friendUserId: 'f1', roomCode: 'ABC123' });
  await act(async () => mockAcks[0].ack(...answer));
  const outcome = await sent;
  await unmount();
  return outcome;
}

beforeEach(() => {
  mockAcks.length = 0;
  mockShowNotification.mockClear();
});

describe('sending an invite', () => {
  it('reports success and says nothing more', async () => {
    expect(await sendAnswered(null, { ok: true, code: 'INVITE_SHOWN' })).toBe(true);
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('tells the player the server refused, in its words', async () => {
    expect(await sendAnswered(null, { ok: false, code: 'NOT_FRIENDS' })).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['server.NOT_FRIENDS'] })
    );
  });

  it('tells the player the invite never arrived', async () => {
    expect(await sendAnswered(new Error('timeout'))).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['room.requestNotDelivered'] })
    );
  });
});
