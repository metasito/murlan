// tests/native/inviteSend.test.tsx — `useInvites().send` is the one way a
// screen invites a friend. A refusal is told once, by the `friend:error` the
// server sends with it; only silence is this hook's to tell, as a request that
// never arrived.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';

import { INTENT_ACK_TIMEOUT_MS } from '@/lib/sendIntent';
import type { IntentReply } from '@/shared/protocol';
import { lastSocket } from './mocks/socketIo';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, forgetSession: async () => {} }),
}));

const mockShowNotification = jest.fn();
jest.mock('@/context/NotificationContext', () =>
  (require('./helpers/notificationMock') as typeof import('./helpers/notificationMock')).notificationContextMock(() => mockShowNotification)
);

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

/** `silence` lets the ack's own timer run out. */
async function sendAnswered(answer: IntentReply | undefined | 'silence') {
  jest.useFakeTimers();
  const { result, unmount } = await mount();
  let sent: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    sent = result.current.send('f1', 'ABC123');
  });
  const [ack] = lastSocket().acks;
  expect(ack.event).toBe('friend:invite');
  expect(ack.payload).toEqual(expect.objectContaining({ friendUserId: 'f1', roomCode: 'ABC123' }));
  await act(async () => {
    if (answer === 'silence') return void jest.advanceTimersByTime(INTENT_ACK_TIMEOUT_MS);
    // As the server does: a refusal is acked and announced as `friend:error`.
    if (answer && !answer.ok) lastSocket().serverEmit('friend:error', { code: answer.code, message: 'refused' });
    ack.answer(answer);
  });
  const outcome = await sent;
  await unmount();
  return outcome;
}

beforeEach(() => {
  mockShowNotification.mockClear();
});

describe('sending an invite', () => {
  it('reports success and says nothing more', async () => {
    expect(await sendAnswered({ ok: true, code: 'INVITE_SHOWN' })).toBe(true);
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('tells the player the server refused, in its words, once', async () => {
    expect(await sendAnswered({ ok: false, code: 'NOT_FRIENDS' })).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['server.NOT_FRIENDS'] })
    );
  });

  it('counts an ack with no reply as heard, as every intent does', async () => {
    expect(await sendAnswered(undefined)).toBe(true);
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('tells the player the invite never arrived', async () => {
    expect(await sendAnswered('silence')).toBe(false);
    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game_error', message: locale['room.requestNotDelivered'] })
    );
  });
});
