// tests/native/rejoinFailed.test.tsx — who a `game:rejoin_failed` is allowed
// to tear down.
//
// The reply is asynchronous, so a failure for the room the player *was* in can
// land after they have already moved to another one. Only a reply naming the
// room still awaited may tear anything down.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { OnlineGameProvider, useOnlineGame } from '@/context/OnlineGameContext';
import { NotificationProvider, useNotification } from '@/context/NotificationContext';
import { en as locale } from '@/locales/en';

type Listener = (...args: unknown[]) => void;

const emitted: { event: string; payload?: unknown }[] = [];
// A set per event, as socket.io has: the provider registers more than one
// `connect` handler, and a map of one would silently keep only the last.
const listeners = new Map<string, Set<Listener>>();

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  },
  off() {},
  emit(event: string, payload?: unknown) {
    emitted.push({ event, payload });
  },
};

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

// context/OnlineGameContext.tsx ACTIVE_ROOM_KEY — the cold-start rejoin handle.
const ACTIVE_ROOM_KEY = '@murlan_active_room';
// REJOIN_RETRY_DELAY_MS / MAX_REJOIN_RETRIES, same file.
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

/**
 * Both contexts in one callback: the notice the teardown raises is the other
 * half of what this file is about, and `renderHook` renders exactly one hook.
 */
const useRejoin = () => ({
  game: useOnlineGame(),
  notification: useNotification().notification,
});

function roomState(roomId: string) {
  return {
    roomId,
    code: roomId,
    hostUserId: 'u1',
    status: 'in_progress' as const,
    gameMode: 'free_for_all' as const,
    maxPlayers: 2,
    players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
  };
}

/** Mounts the provider with `roomId` already persisted, so it rejoins on mount. */
async function mountRejoining(roomId: string) {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId);
  // Out here, not in the wrapper's body, which React re-runs on every render.
  const client = new QueryClient();
  const hook = await renderHook(useRejoin, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <OnlineGameProvider userId="u1">{children}</OnlineGameProvider>
        </NotificationProvider>
      </QueryClientProvider>
    ),
  });
  // The persisted id is read back asynchronously; the rejoin follows it.
  await waitFor(() =>
    expect(emitted).toContainEqual({ event: 'game:rejoin', payload: { roomId } })
  );
  return hook;
}

// The provider's own listeners are what the socket calls at runtime. Async
// act(), not the synchronous form: several of these handlers settle a promise
// before they set state, and a sync act() closes before that lands.
const deliver = async (event: string, payload: unknown) => {
  await act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });
};

const failure = (roomId: string) => ({
  roomId,
  code: 'GAME_NOT_FOUND',
  message: 'Game not found',
});

describe('game:rejoin_failed', () => {
  beforeEach(async () => {
    emitted.length = 0;
    listeners.clear();
    await AsyncStorage.clear();
  });

  it('ignores a reply for a room the player has already left behind', async () => {
    const { result, unmount } = await mountRejoining('R1');

    await deliver('room:state', roomState('R2'));
    await waitFor(() => expect(result.current.game.room?.roomId).toBe('R2'));

    await deliver('game:rejoin_failed', failure('R1'));

    expect(result.current.game.room?.roomId).toBe('R2');
    expect(result.current.game.rejoinFailed).toBe(false);
    expect(result.current.notification).toBeNull();

    await unmount();
  });

  it('still tears down while that room is the outstanding attempt', async () => {
    const { result, unmount } = await mountRejoining('R1');

    await deliver('game:rejoin_failed', failure('R1'));

    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(true));
    expect(result.current.game.room).toBeNull();
    // The whole point of the code: the player is told which failure this was,
    // in their own language, rather than watching the table disappear.
    expect(result.current.notification?.message).toBe(locale['server.GAME_NOT_FOUND']);
    // The seat is the disconnect grace timer's to release, not this path's.
    expect(emitted.map((e) => e.event)).not.toContain('room:leave');

    await unmount();
  });

  // ── RES-03: SERVER_ERROR is the handler's blanket catch, not a verdict ───

  it('retries a SERVER_ERROR without destroying the way back in', async () => {
    jest.useFakeTimers();
    try {
      const { result, unmount } = await mountRejoining('R1');
      emitted.length = 0;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        await deliver('game:rejoin_failed', { roomId: 'R1', code: 'SERVER_ERROR' });
        expect(result.current.game.rejoinFailed).toBe(false);
        expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBe('R1');
        jest.advanceTimersByTime(RETRY_DELAY_MS);
      }
      expect(emitted).toHaveLength(MAX_RETRIES);
      expect(emitted.every((e) => e.event === 'game:rejoin')).toBe(true);

      // Past the cap it is treated as terminal, so a server that is genuinely
      // down does not leave the player retrying into the rate limiter.
      await deliver('game:rejoin_failed', { roomId: 'R1', code: 'SERVER_ERROR' });
      jest.advanceTimersByTime(RETRY_DELAY_MS * 4);
      expect(emitted).toHaveLength(MAX_RETRIES);

      await waitFor(() => expect(result.current.game.rejoinFailed).toBe(true));
      expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBeNull();

      await unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  // The provider outlives the game screen, so the flag has to be cleared by
  // every entry into a table as well as on the way out of one — a spectator
  // arriving with it still set is bounced out of the game screen on sight.
  it('does not survive into a spectated table', async () => {
    const { result, unmount } = await mountRejoining('R1');

    await deliver('game:rejoin_failed', failure('R1'));
    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(true));

    await waitFor(() => result.current.game.spectateRoom('ABCDEF'));
    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(false));
    expect(emitted).toContainEqual({
      event: 'room:spectate',
      payload: { code: 'ABCDEF' },
    });

    await unmount();
  });
});
