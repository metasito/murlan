// tests/native/useRejoin.test.tsx — a SERVER_ERROR is retried, three times,
// two seconds apart, and then given up on.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { useRejoin } from '@/context/useRejoin';
import type { Socket } from '@/lib/socket';
import type { GameState } from '@/lib/game/gameEngine';
import type { WireRoomState } from '@/shared/protocol';

const emitted: { event: string; payload?: unknown }[] = [];

const mockSocket = {
  connected: false,
  on() {},
  off() {},
  timeout() {
    return mockSocket;
  },
  emit(event: string, payload?: unknown) {
    emitted.push({ event, payload });
  },
} as unknown as Socket;

const playing: WireRoomState = {
  roomId: 'R1',
  code: 'ABCD',
  hostUserId: 'u1',
  status: 'in_progress',
  gameMode: 'free_for_all',
  visibility: 'private',
  maxPlayers: 2,
  players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
};

async function mount(room: WireRoomState | null) {
  const roomRef = { current: room };
  const gameStateRef = { current: null as GameState | null };
  const seatLossRef = { current: null };
  const view = await renderHook(() => useRejoin(mockSocket, 'u1', roomRef, gameStateRef, seatLossRef));
  return { ...view, roomRef };
}

const rejoins = () => emitted.filter((e) => e.event === 'game:rejoin').length;

describe('useRejoin', () => {
  beforeEach(async () => {
    emitted.length = 0;
    await AsyncStorage.clear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries three times at 2000 ms, then refuses a fourth', async () => {
    const { result, unmount } = await mount(playing);
    const nothingSent = jest.fn();

    for (let n = 1; n <= 3; n++) {
      expect(result.current.retry(nothingSent)).toBe(true);
      await act(async () => jest.advanceTimersByTime(1999));
      expect(rejoins()).toBe(n - 1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(rejoins()).toBe(n);
    }
    expect(result.current.retry(nothingSent)).toBe(false);
    expect(nothingSent).not.toHaveBeenCalled();
    await unmount();
  });

  it('gives the cap back once live state answers', async () => {
    const { result, unmount } = await mount(playing);

    for (let n = 0; n < 3; n++) result.current.retry(() => {});
    result.current.answered();

    expect(result.current.retry(() => {})).toBe(true);
    await unmount();
  });

  it('calls a retry that finds nothing to ask for the end of the line', async () => {
    const { result, roomRef, unmount } = await mount(playing);
    const nothingSent = jest.fn();

    result.current.retry(nothingSent);
    roomRef.current = null;
    await act(async () => jest.advanceTimersByTime(2000));

    expect(nothingSent).toHaveBeenCalledTimes(1);
    expect(rejoins()).toBe(0);
    await unmount();
  });

  it('sends nothing once the socket it was set for is gone', async () => {
    const { result, unmount } = await mount(playing);

    result.current.retry(() => {});
    await unmount();
    await act(async () => jest.advanceTimersByTime(2000));

    expect(rejoins()).toBe(0);
  });
});
