// tests/native/rejoinFailed.test.tsx — who a `game:rejoin_failed` is allowed
// to tear down.
//
// The reply is asynchronous, so a failure for the room the player *was* in can
// land after they have already moved to another one. Only a reply naming the
// room still awaited may tear anything down.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor } from '@testing-library/react-native';

import { useOnlineGame } from './onlineSurface';
import { useBanner } from '@/context/NotificationContext';
import { renderAppHook } from './harness/renderApp';
import { room } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';
import { en as locale } from '@/locales/en';

import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { MAX_REJOIN_RETRIES, REJOIN_RETRY_DELAY_MS } from '@/context/useRejoin';

/**
 * Both contexts in one callback: the notice the teardown raises is the other
 * half of what this file is about, and `renderHook` renders exactly one hook.
 */
const useRejoin = () => ({
  game: useOnlineGame(),
  notification: useBanner().notification,
});

const roomState = (roomId: string) =>
  room({ roomId, code: roomId, status: 'in_progress', maxPlayers: 2, players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }] });

let live: FakeSocket;
const emitted = () => live.sent.map((e) => ({ event: e.event, payload: e.args[0] }));

/** Mounts the provider with `roomId` already persisted, so it rejoins on mount. */
async function mountRejoining(roomId: string) {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, roomId);
  const hook = await renderAppHook(useRejoin, { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
  live = hook.socket();
  // The persisted id is read back asynchronously; the rejoin follows it.
  await waitFor(() =>
    expect(emitted()).toContainEqual({ event: 'game:rejoin', payload: expect.objectContaining({ roomId }) })
  );
  return hook;
}

const failure = (roomId: string) => ({
  roomId,
  code: 'GAME_NOT_FOUND',
  message: 'Game not found',
});

it('retries a rejoin at least once, after a wait', () => {
  expect(MAX_REJOIN_RETRIES).toBeGreaterThan(0);
  expect(REJOIN_RETRY_DELAY_MS).toBeGreaterThan(0);
});

describe('game:rejoin_failed', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("Riprova cuts the socket, opens it again, and rejoins through the connect handler", async () => {
    const { result, unmount } = await mountRejoining('R1');
    live.reset();

    await act(async () => result.current.game.retryConnection());

    expect(live.disconnect).toHaveBeenCalledTimes(1);
    expect(live.connect).toHaveBeenCalledTimes(1);
    expect(live.disconnect.mock.invocationCallOrder[0]).toBeLessThan(live.connect.mock.invocationCallOrder[0]);
    expect(emitted()).toEqual([]);
    await act(async () => live.open());
    await waitFor(() =>
      expect(emitted()).toContainEqual({ event: 'game:rejoin', payload: expect.objectContaining({ roomId: 'R1' }) })
    );
    await unmount();
  });

  it('ignores a reply for a room the player has already left behind', async () => {
    const { result, unmount } = await mountRejoining('R1');

    await live.deliver('room:state', roomState('R2'));
    await waitFor(() => expect(result.current.game.room?.roomId).toBe('R2'));

    await live.deliver('game:rejoin_failed', failure('R1'));

    expect(result.current.game.room?.roomId).toBe('R2');
    expect(result.current.game.rejoinFailed).toBe(false);
    expect(result.current.notification).toBeNull();

    await unmount();
  });

  it('still tears down while that room is the outstanding attempt', async () => {
    const { result, unmount } = await mountRejoining('R1');

    await live.deliver('game:rejoin_failed', failure('R1'));

    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(true));
    expect(result.current.game.room).toBeNull();
    // The whole point of the code: the player is told which failure this was,
    // in their own language, rather than watching the table disappear.
    expect(result.current.notification?.message).toBe(locale['server.GAME_NOT_FOUND']);
    // The seat is the disconnect grace timer's to release, not this path's.
    expect(emitted().map((e) => e.event)).not.toContain('room:leave');

    await unmount();
  });

  // ── RES-03: SERVER_ERROR is the handler's blanket catch, not a verdict ───

  it('retries a SERVER_ERROR without destroying the way back in', async () => {
    jest.useFakeTimers();
    try {
      const { result, unmount } = await mountRejoining('R1');
      live.reset();

      for (let attempt = 0; attempt < MAX_REJOIN_RETRIES; attempt++) {
        await live.deliver('game:rejoin_failed', { roomId: 'R1', code: 'SERVER_ERROR' });
        expect(result.current.game.rejoinFailed).toBe(false);
        expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBe('R1');
        await act(async () => void jest.advanceTimersByTime(REJOIN_RETRY_DELAY_MS));
      }
      expect(emitted()).toHaveLength(MAX_REJOIN_RETRIES);
      expect(emitted().every((e) => e.event === 'game:rejoin')).toBe(true);

      // Past the cap it is treated as terminal, so a server that is genuinely
      // down does not leave the player retrying into the rate limiter.
      await live.deliver('game:rejoin_failed', { roomId: 'R1', code: 'SERVER_ERROR' });
      await act(async () => void jest.advanceTimersByTime(REJOIN_RETRY_DELAY_MS * 4));
      expect(emitted()).toHaveLength(MAX_REJOIN_RETRIES);

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

    await live.deliver('game:rejoin_failed', failure('R1'));
    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(true));

    await waitFor(() => result.current.game.spectateRoom('ABCDEF'));
    await waitFor(() => expect(result.current.game.rejoinFailed).toBe(false));
    expect(emitted()).toContainEqual({
      event: 'room:spectate',
      payload: expect.objectContaining({ code: 'ABCDEF' }),
    });

    await unmount();
  });
});
