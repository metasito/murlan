// tests/native/handEndRefreshesRatings.test.tsx — a finished hand marks every
// cached figure it can have moved as stale, the ladder's included.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

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

  it('takes the rating after the hand from game:over, not from a ladder read that can predate its write', async () => {
    const queryFn = jest.fn(async () => ({ season: '2026-10', rating: 1000, games: 2, provisional: true }));
    const client = new QueryClient({ defaultOptions: { queries: { queryFn, staleTime: Infinity, retry: false } } });

    const { result, unmount } = await renderHook(() => useOnlineGame(), {
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
        fn({
          rankings: [],
          scores: [],
          matchOver: true,
          matchWinnerIds: [],
          ratingDeltas: { u1: 14 },
          ratingsAfter: { u1: { rating: 1014, games: 3 } },
          recorded: true,
        })
      );
    });

    expect(result.current.ratingsAfter).toEqual({ u1: { rating: 1014, games: 3 } });
    expect(queryFn).not.toHaveBeenCalled();
    await unmount();
  });
});
