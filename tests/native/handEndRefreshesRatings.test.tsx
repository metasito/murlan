// tests/native/handEndRefreshesRatings.test.tsx — a finished hand marks every
// cached figure it can have moved as stale, the ladder's included.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { OnlineGameProvider, useOnlineGame } from '@/context/OnlineGameContext';
import { NotificationProvider } from '@/context/NotificationContext';

type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  },
  off() {},
  once() {},
  timeout() {
    return mockSocket;
  },
  emit() {},
};

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

describe('game:over', () => {
  it('invalidates the stats and the ratings', async () => {
    const client = new QueryClient();
    const invalidated: unknown[] = [];
    const real = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
      invalidated.push(filters?.queryKey?.[0]);
      return real(filters as never);
    }) as typeof client.invalidateQueries;

    const { unmount } = await renderHook(() => useOnlineGame(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
          <NotificationProvider>
            <OnlineGameProvider userId="u1">{children}</OnlineGameProvider>
          </NotificationProvider>
        </QueryClientProvider>
      ),
    });

    await act(async () => {
      listeners.get('game:over')?.forEach((fn) =>
        fn({ rankings: [], scores: [], matchOver: false, matchWinnerIds: [], ratingDeltas: {} })
      );
    });

    for (const key of ['/api/stats/me', '/api/ratings/me', '/api/ratings/leaderboard']) {
      expect(invalidated).toContain(key);
    }
    await unmount();
  });
});
