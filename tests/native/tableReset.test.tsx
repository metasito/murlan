// tests/native/tableReset.test.tsx — leaving a table leaves nothing of it.
//
// Every teardown runs the one reset, so a table played to its last round and
// then left reads exactly like a provider that never sat at one.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { useOnlineGame } from './onlineSurface';
import { NotificationProvider } from '@/context/NotificationContext';

type Listener = (...args: unknown[]) => void;
type OnlineGameContextValue = ReturnType<typeof useOnlineGame>;

const emitted: { event: string; payload?: unknown }[] = [];
const listeners = new Map<string, Set<Listener>>();
const subscribed = new Map<string, number>();
const unsubscribed = new Map<string, number>();

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    subscribed.set(event, (subscribed.get(event) ?? 0) + 1);
  },
  off(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
    unsubscribed.set(event, (unsubscribed.get(event) ?? 0) + 1);
  },
  once() {},
  timeout() {
    return mockSocket;
  },
  emit(event: string, payload?: unknown) {
    emitted.push({ event, payload });
  },
};

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

async function mount() {
  const client = new QueryClient();
  return renderHook(() => useOnlineGame(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <OnlineGameProvider userId="u1">{children}</OnlineGameProvider>
        </NotificationProvider>
      </QueryClientProvider>
    ),
  });
}

const deliver = async (event: string, payload?: unknown) => {
  await act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });
};

/** Everything a screen can read, without the actions and the socket's own state. */
function dataOf(value: OnlineGameContextValue) {
  const { connected: _connected, ownLink: _ownLink, ...rest } = value;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
}

/** A table played through a round: every field the table owns holds something. */
async function playARound() {
  await deliver('room:state', {
    roomId: 'R1',
    code: 'ABCD',
    hostUserId: 'u1',
    status: 'in_progress',
    gameMode: 'free_for_all',
    maxPlayers: 2,
    players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
  });
  await deliver('game:state', {
    players: [
      { id: 'player_0', name: 'Ana', hand: [], type: 'human', handCount: 0, vacated: false },
      { id: 'player_1', name: 'Besi', hand: [], type: 'human', handCount: 0, vacated: false },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: 'free_for_all',
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: true,
    viewerSeatIndex: 0,
    turnDeadlineMs: 1000,
    turnSecondsRemaining: 30,
  });
  await deliver('game:notification', {
    type: 'afk',
    code: 'PLAYER_AFK_AUTO_PASS',
    params: { username: 'Ana' },
    message: 'Ana auto-passed',
  });
  await deliver('game:match_state', { target: 41, length: 'match', roundsPlayed: 1, scores: { player_0: 5 } });
  await deliver('game:round_over', {
    finishingOrder: ['player_0', 'player_1'],
    scores: [{ engineId: 'player_0', points: 3, total: 8 }],
    matchOver: true,
    matchWinnerIds: ['player_0'],
    ratingDeltas: { u1: 14 },
    ratingsAfter: { u1: { rating: 1014, rounds: 3 } },
    recorded: true,
  });
}

beforeEach(async () => {
  emitted.length = 0;
  listeners.clear();
  subscribed.clear();
  unsubscribed.clear();
  await AsyncStorage.clear();
});

describe('a table torn down', () => {
  const TEARDOWNS: { what: string; run: (value: OnlineGameContextValue) => Promise<void>; differs: object }[] = [
    {
      what: 'left',
      run: async (value) => {
        await act(async () => value.leaveRoom());
      },
      differs: {},
    },
    {
      what: 'given up on by a rejoin',
      run: () => deliver('game:rejoin_failed', { code: 'GAME_NOT_FOUND', message: 'Game not found' }),
      differs: { rejoinFailed: true },
    },
  ];

  for (const { what, run, differs } of TEARDOWNS) {
    it(`when ${what} reads as a provider that never sat at one`, async () => {
      const { result, unmount } = await mount();
      const fresh = dataOf(result.current);

      await playARound();
      const played = dataOf(result.current);
      for (const field of [
        'autoPassed',
        'placementPoints',
        'ratingDeltas',
        'roundRecorded',
        'ratingsAfter',
        'matchState',
        'turnSeconds',
        'turnDeadlineMs',
      ]) {
        expect({ [field]: played[field] }).not.toEqual({ [field]: fresh[field] });
      }

      await run(result.current);

      expect(dataOf(result.current)).toEqual({ ...fresh, ...differs });
      expect(await AsyncStorage.getAllKeys()).toEqual([]);
      await unmount();
    });
  }
});

describe('a room code', () => {
  it('is sent in its one spelling, and a code that is none is not sent at all', async () => {
    const { result, unmount } = await mount();

    await act(async () => {
      result.current.joinRoom(' abcd ');
      result.current.spectateRoom('xy9z');
      result.current.joinRoom('ab');
      result.current.spectateRoom('no way!');
    });

    expect(emitted.filter((e) => e.event === 'room:join' || e.event === 'room:spectate')).toEqual([
      { event: 'room:join', payload: expect.objectContaining({ code: 'ABCD' }) },
      { event: 'room:spectate', payload: expect.objectContaining({ code: 'XY9Z' }) },
    ]);
    await unmount();
  });
});

describe('the listener effect', () => {
  it('subscribes once for the life of a socket, whatever the table does', async () => {
    const { result, unmount } = await mount();

    await playARound();
    await act(async () => result.current.spectateRoom('ABCD'));
    await act(async () => result.current.leaveRoom());
    await act(async () => result.current.joinRoom('ABCD'));
    await deliver('game:rejoin_failed', { code: 'GAME_NOT_FOUND', message: 'Game not found' });

    for (const event of ['game:state', 'room:state', 'game:rejoin_failed', 'room:error']) {
      expect({ event, subscribed: subscribed.get(event) }).toEqual({ event, subscribed: 1 });
    }
    await unmount();
    for (const event of ['game:state', 'room:state', 'game:rejoin_failed', 'room:error']) {
      expect({ event, unsubscribed: unsubscribed.get(event) }).toEqual({ event, unsubscribed: 1 });
    }
  });
});

describe('a room:error while a lobby rejoin is outstanding', () => {
  async function inALobbyRejoining(result: { current: OnlineGameContextValue }) {
    await deliver('room:state', {
      roomId: 'R1',
      code: 'ABCD',
      hostUserId: 'u1',
      status: 'waiting',
      gameMode: 'free_for_all',
      maxPlayers: 2,
      players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
    });
    await deliver('game:match_state', { target: 41, length: 'match', roundsPlayed: 1, scores: { player_0: 5 } });
    await deliver('connect');
    expect(emitted).toContainEqual({ event: 'room:rejoin', payload: expect.objectContaining({ code: 'ABCD' }) });
    expect(result.current.matchState.target).toBe(41);
  }

  it('is the refusal of that rejoin, and resets the whole table', async () => {
    const { result, unmount } = await mount();
    const { error: _fresh, ...fresh } = dataOf(result.current);
    await inALobbyRejoining(result);

    await deliver('room:error', { code: 'ROOM_FULL', message: 'Room is full' });

    const { error, ...rest } = dataOf(result.current);
    expect(rest).toEqual(fresh);
    expect(error).not.toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    await unmount();
  });

  it('answers a join sent since, which cancelled the rejoin, and resets nothing', async () => {
    const { result, unmount } = await mount();
    await inALobbyRejoining(result);
    await act(async () => result.current.joinRoom('WXYZ'));
    const { error: _before, ...before } = dataOf(result.current);

    await deliver('room:error', { code: 'ROOM_FULL', message: 'Room is full' });

    const { error, ...rest } = dataOf(result.current);
    expect(rest).toEqual(before);
    expect(error).not.toBeNull();
    await unmount();
  });
});
