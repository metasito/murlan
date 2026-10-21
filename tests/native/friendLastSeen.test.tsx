// tests/native/friendLastSeen.test.tsx — a friend:status offline event carries
// the disconnect time the server just wrote. The friends row reads its time
// from the ["/api/friends"] cache, so an event that updates only onlineIds
// leaves the row showing whatever the last fetch returned — which, taken while
// the friend was still online, is their *previous* disconnect.
import { describe, it, expect, beforeEach } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

import { queryClient as qc } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { lastSocket } from './mocks/socketIo';

const PREVIOUS_DISCONNECT = '2026-08-20T10:00:00.000Z';
const JUST_NOW = '2026-08-20T10:11:00.000Z';

function friendsIn() {
  return qc.getQueryData(['/api/friends']) as { id: string; username: string; lastSeen: string | null }[];
}

describe('friend:status carries the time the row shows', () => {
  beforeEach(async () => {
    qc.setQueryData(['/api/friends'], [
      { id: 'f1', username: 'Ben', lastSeen: PREVIOUS_DISCONNECT },
      { id: 'f2', username: 'Drita', lastSeen: PREVIOUS_DISCONNECT },
    ]);
    await renderApp(<Text>probe</Text>, { user: { id: 'u1', username: 'Ana' } });
  });

  it('writes the disconnect time the event carries into the friends cache', async () => {
    expect(lastSocket().listening('friend:status')).toBe(1);

    await act(async () => {
      lastSocket().serverEmit('friend:status', { userId: 'f1', online: false, lastSeen: JUST_NOW });
    });

    expect(friendsIn().find((f) => f.id === 'f1')!.lastSeen).toBe(JUST_NOW);
  });

  it('moves no one else, and keeps the rest of the row intact', async () => {
    await act(async () => {
      lastSocket().serverEmit('friend:status', { userId: 'f1', online: false, lastSeen: JUST_NOW });
    });

    const other = friendsIn().find((f) => f.id === 'f2')!;
    expect(other.lastSeen).toBe(PREVIOUS_DISCONNECT);
    expect(friendsIn().find((f) => f.id === 'f1')!.username).toBe('Ben');
  });

  it('leaves the cache alone when the event carries no time', async () => {
    await act(async () => {
      lastSocket().serverEmit('friend:status', { userId: 'f1', online: true });
    });

    expect(friendsIn().find((f) => f.id === 'f1')!.lastSeen).toBe(PREVIOUS_DISCONNECT);
  });
});
