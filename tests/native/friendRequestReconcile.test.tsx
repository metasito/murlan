// tests/native/friendRequestReconcile.test.tsx — reconnecting re-reads what
// arrived while you were gone, and only then.
//
// `emitToUser` (server/socket/socketRegistry.ts) delivers to a connected socket
// and drops the event otherwise: no queue, no retry. A request sent to someone
// who is offline reaches their database row and nothing else, so the client
// must ask again. The server's connect push carries the account's social
// version (server/store/presence.ts), which moves on every friend or invite
// change: a version other than the last one seen, or none, is when it asks.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

import { queryClient as qc } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { lastSocket } from './mocks/socketIo';

/** The queries whose rows can change while the socket is down. */
const PENDING_KEYS = ['/api/friends/requests', '/api/friends/sent', '/api/friends', '/api/friends/invites'];

async function harness() {
  const invalidated: string[] = [];
  const realInvalidate = qc.invalidateQueries.bind(qc);
  jest.spyOn(qc, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
    const key = filters?.queryKey?.[0];
    if (typeof key === 'string') invalidated.push(key);
    return realInvalidate(filters as never);
  }) as typeof qc.invalidateQueries);

  await renderApp(<Text>probe</Text>, { user: { id: 'u1', username: 'Ana' } });
  return { invalidated };
}

/** A connect as the server makes it: the socket opens, then the online list is pushed. */
async function connect(social?: string) {
  await act(async () => lastSocket().open());
  await lastSocket().deliver('friend:online_list', { onlineIds: [], ...(social !== undefined && { social }) });
}

async function reconnect(social?: string) {
  await act(async () => lastSocket().drop('transport close'));
  await connect(social);
}

describe('a reconnect reconciles what arrived while the socket was down', () => {
  it('re-reads every list on the first connect, when no version has been seen yet', async () => {
    const { invalidated } = await harness();
    await connect('e.1');
    for (const key of PENDING_KEYS) expect(invalidated).toContain(key);
  });

  it('re-reads nothing on a reconnect whose version is the one already seen', async () => {
    const { invalidated } = await harness();
    await connect('e.1');
    invalidated.length = 0;
    await reconnect('e.1');
    expect(invalidated.filter((k) => PENDING_KEYS.includes(k))).toEqual([]);
  });

  it('re-reads every list on a reconnect whose version moved', async () => {
    const { invalidated } = await harness();
    await connect('e.1');
    invalidated.length = 0;
    await reconnect('e.2');
    for (const key of PENDING_KEYS) expect(invalidated).toContain(key);
  });

  it('re-reads every list on a reconnect that carries no version', async () => {
    const { invalidated } = await harness();
    await connect('e.1');
    invalidated.length = 0;
    await reconnect();
    for (const key of PENDING_KEYS) expect(invalidated).toContain(key);
  });

  it('does not ask who is online on connect: the server pushes it', async () => {
    await harness();
    const before = lastSocket().sent.length;
    await act(async () => lastSocket().open());
    expect(lastSocket().sent.slice(before).map((s) => s.event)).not.toContain('friend:get_online_list');
  });

  it('still asks who is online once a friend request is accepted', async () => {
    await harness();
    await connect('e.1');
    const before = lastSocket().sent.length;
    await lastSocket().deliver('friend:request_accepted', { by: 'Besi' });
    expect(lastSocket().sent.slice(before).map((s) => s.event)).toContain('friend:get_online_list');
  });
});
