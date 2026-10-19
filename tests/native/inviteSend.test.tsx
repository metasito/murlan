// tests/native/inviteSend.test.tsx — `useInvites().send` is the one way a
// screen invites a friend. A refusal is told once, by the `friend:error` the
// server sends with it; only silence is this hook's to tell, as a request that
// never arrived.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';

type Ack = (err: unknown, reply?: { ok: boolean; code?: string }) => void;
const mockAcks: { event: string; payload: unknown; ack: Ack }[] = [];

type Listener = (payload: unknown) => void;
const mockListeners = new Map<string, Listener>();

const mockSocket = {
  connected: false,
  active: true,
  on(event: string, fn: Listener) {
    mockListeners.set(event, fn);
  },
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
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, forgetSession: async () => {} }),
}));

const mockShowNotification = jest.fn();
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => {
    const { t, translateServerPayload } = jest.requireActual('@/lib/i18n') as typeof import('@/lib/i18n');
    const notifyError = (message: string, opts?: { title?: string; duration?: number }) =>
      mockShowNotification({ type: 'game_error', title: opts?.title ?? t('common.error'), message, duration: opts?.duration });
    return {
      showNotification: mockShowNotification,
      notifyError,
      notifyServerError: (payload: import('@/lib/i18n').ServerPayload) => notifyError(translateServerPayload(payload)),
    };
  },
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
  expect(mockAcks[0].payload).toEqual(expect.objectContaining({ friendUserId: 'f1', roomCode: 'ABC123' }));
  await act(async () => {
    const [, reply] = answer;
    // As the server does: a refusal is acked and announced as `friend:error`.
    if (reply && !reply.ok) mockListeners.get('friend:error')?.({ code: reply.code, message: 'refused' });
    mockAcks[0].ack(...answer);
  });
  const outcome = await sent;
  await unmount();
  return outcome;
}

beforeEach(() => {
  mockAcks.length = 0;
  mockListeners.clear();
  mockShowNotification.mockClear();
});

describe('sending an invite', () => {
  it('reports success and says nothing more', async () => {
    expect(await sendAnswered(null, { ok: true, code: 'INVITE_SHOWN' })).toBe(true);
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('tells the player the server refused, in its words, once', async () => {
    expect(await sendAnswered(null, { ok: false, code: 'NOT_FRIENDS' })).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['server.NOT_FRIENDS'] })
    );
  });

  it('counts an ack with no reply as heard, as every intent does', async () => {
    expect(await sendAnswered(null)).toBe(true);
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('tells the player the invite never arrived', async () => {
    expect(await sendAnswered(new Error('timeout'))).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['room.requestNotDelivered'] })
    );
  });
});
