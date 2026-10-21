import { describe, it, expect } from '@jest/globals';

import { connectSocket, disconnectSocket } from '@/lib/socket';
import { route, type HttpReply } from './mocks/http';
import { lastSocket } from './mocks/socketIo';

function deferredTickets() {
  const resolvers: ((ticket: string) => void)[] = [];
  route(
    'POST',
    '/api/auth/socket-ticket',
    () => new Promise<HttpReply>((resolve) => resolvers.push((ticket) => resolve({ body: { ticket } })))
  );
  return resolvers;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('socket auth ticket attempts', () => {
  it('delivers only the latest attempt when a retry supersedes a pending one', async () => {
    const tickets = deferredTickets();
    connectSocket('u1', { onAuthFailure: () => {} });
    const socket = lastSocket();
    const delivered: Record<string, unknown>[] = [];
    await flush();

    void socket.handshake().then((d) => delivered.push(d));
    void socket.handshake().then((d) => delivered.push(d));
    await flush();
    tickets[0]('first');
    tickets[1]('stale');
    await flush();
    tickets[2]('fresh');
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].ticket).toBe('fresh');
    disconnectSocket('u1');
  });

  it('still delivers a lone slow attempt', async () => {
    const tickets = deferredTickets();
    connectSocket('u2', { onAuthFailure: () => {} });
    const delivered: Record<string, unknown>[] = [];

    void lastSocket().credentials!.then((d) => delivered.push(d));
    await flush();
    tickets[0]('only');
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].ticket).toBe('only');
    disconnectSocket('u2');
  });
});
