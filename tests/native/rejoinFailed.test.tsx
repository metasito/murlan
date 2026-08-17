// tests/native/rejoinFailed.test.tsx — who a `game:rejoin_failed` is allowed
// to tear down.
//
// The reply is asynchronous, so a failure for the room the player *was* in can
// land after they have already moved to another one. The guard used to engage
// only while an attempt was outstanding, which is exactly backwards: every
// path meaning "we are no longer waiting" cleared the ref, so the late reply
// sailed through and ejected the player from the room that replaced it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';

import { OnlineGameProvider, useOnlineGame } from '@/context/OnlineGameContext';
import { NotificationProvider, useNotification } from '@/context/NotificationContext';
import { it as itLocale } from '@/locales/it';

type Listener = (...args: unknown[]) => void;

const emitted: Array<{ event: string; payload?: unknown }> = [];
const listeners = new Map<string, Listener>();

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    listeners.set(event, fn);
  },
  off() {},
  emit(event: string, payload?: unknown) {
    emitted.push({ event, payload });
  },
};

jest.mock('@/lib/socket', () => ({ getSocket: () => mockSocket }));

// context/OnlineGameContext.tsx ACTIVE_ROOM_KEY — the cold-start rejoin handle.
const ACTIVE_ROOM_KEY = '@murlan_active_room';
// REJOIN_RETRY_DELAY_MS / MAX_REJOIN_RETRIES, same file.
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function Probe() {
  const { room, rejoinFailed } = useOnlineGame();
  const { notification } = useNotification();
  return (
    <>
      <Text testID="room">{room ? room.roomId : 'none'}</Text>
      <Text testID="failed">{String(rejoinFailed)}</Text>
      <Text testID="notice">{notification ? notification.message : 'none'}</Text>
    </>
  );
}

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
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <OnlineGameProvider userId="u1">
          <Probe />
        </OnlineGameProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
  // The persisted id is read back asynchronously; the rejoin follows it.
  await waitFor(() =>
    expect(emitted).toContainEqual({ event: 'game:rejoin', payload: { roomCode: roomId } })
  );
  return view;
}

// Delivered straight to the handler, not inside act(): the provider's own
// listeners are what the socket calls at runtime, and wrapping them here makes
// react-test-renderer drop the resulting updates. `waitFor` flushes them.
const deliver = (event: string, payload: unknown) => listeners.get(event)?.(payload);

const failure = (roomCode: string) => ({
  roomCode,
  code: 'GAME_NOT_FOUND',
  message: 'Game not found',
});

type View = Awaited<ReturnType<typeof render>>;

const shown = (view: View, id: string) => view.getByTestId(id).props.children;

describe('game:rejoin_failed', () => {
  beforeEach(async () => {
    emitted.length = 0;
    listeners.clear();
    await AsyncStorage.clear();
  });

  it('ignores a reply for a room the player has already left behind', async () => {
    const view = await mountRejoining('R1');

    deliver('room:state', roomState('R2'));
    await waitFor(() => expect(shown(view, 'room')).toBe('R2'));

    deliver('game:rejoin_failed', failure('R1'));

    expect(shown(view, 'room')).toBe('R2');
    expect(shown(view, 'failed')).toBe('false');
    expect(shown(view, 'notice')).toBe('none');

    await view.unmount();
  });

  it('still tears down while that room is the outstanding attempt', async () => {
    const view = await mountRejoining('R1');

    deliver('game:rejoin_failed', failure('R1'));

    await waitFor(() => expect(shown(view, 'failed')).toBe('true'));
    expect(shown(view, 'room')).toBe('none');
    // The whole point of the code: the player is told which failure this was,
    // in their own language, rather than watching the table disappear.
    expect(shown(view, 'notice')).toBe(itLocale['server.GAME_NOT_FOUND']);
    // The seat is the disconnect grace timer's to release, not this path's.
    expect(emitted.map((e) => e.event)).not.toContain('room:leave');

    await view.unmount();
  });

  // ── RES-03: SERVER_ERROR is the handler's blanket catch, not a verdict ───

  it('retries a SERVER_ERROR without destroying the way back in', async () => {
    jest.useFakeTimers();
    try {
      const view = await mountRejoining('R1');
      emitted.length = 0;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        deliver('game:rejoin_failed', { roomCode: 'R1', code: 'SERVER_ERROR' });
        expect(shown(view, 'failed')).toBe('false');
        expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBe('R1');
        jest.advanceTimersByTime(RETRY_DELAY_MS);
      }
      expect(emitted).toHaveLength(MAX_RETRIES);
      expect(emitted.every((e) => e.event === 'game:rejoin')).toBe(true);

      // Past the cap it is treated as terminal, so a server that is genuinely
      // down does not leave the player retrying into the rate limiter.
      deliver('game:rejoin_failed', { roomCode: 'R1', code: 'SERVER_ERROR' });
      jest.advanceTimersByTime(RETRY_DELAY_MS * 4);
      expect(emitted).toHaveLength(MAX_RETRIES);

      await waitFor(() => expect(shown(view, 'failed')).toBe('true'));
      expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBeNull();

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
