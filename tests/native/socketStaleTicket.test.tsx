import { describe, it, expect, beforeEach, jest } from '@jest/globals';

type AuthFn = (cb: (data: Record<string, unknown>) => void) => void;

const mockIo = jest.fn();
jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...args) }));
jest.mock('@/lib/query-client', () => ({ getApiUrl: () => 'http://localhost/' }));

import { connectSocket, disconnectSocket } from '@/lib/socket';

function deferredTickets() {
  const resolvers: ((ticket: string) => void)[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        resolvers.push((ticket) => resolve({ status: 200, ok: true, json: async () => ({ ticket }) }));
      }),
  );
  return resolvers;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('socket auth ticket attempts', () => {
  beforeEach(() => {
    mockIo.mockReset();
    mockIo.mockReturnValue({ removeAllListeners() {}, disconnect() {} });
  });

  it('delivers only the latest attempt when a retry supersedes a pending one', async () => {
    const tickets = deferredTickets();
    connectSocket('u1', { onAuthFailure: () => {} });
    const auth = (mockIo.mock.calls[0][1] as { auth: AuthFn }).auth;
    const delivered: Record<string, unknown>[] = [];

    auth((d) => delivered.push(d));
    auth((d) => delivered.push(d));
    tickets[0]('stale');
    await flush();
    tickets[1]('fresh');
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].ticket).toBe('fresh');
    disconnectSocket('u1');
  });

  it('still delivers a lone slow attempt', async () => {
    const tickets = deferredTickets();
    connectSocket('u2', { onAuthFailure: () => {} });
    const auth = (mockIo.mock.calls[0][1] as { auth: AuthFn }).auth;
    const delivered: Record<string, unknown>[] = [];

    auth((d) => delivered.push(d));
    await flush();
    tickets[0]('only');
    await flush();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].ticket).toBe('only');
    disconnectSocket('u2');
  });
});
