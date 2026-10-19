// tests/native/sliceRenderCounts.test.tsx — a field change wakes one slice.
//
// `armTurn` emits `game:turn_deadline` after every state change, every rejoin
// and every disconnect, so the turn clock is the hottest field on the surface,
// and the online screens the router holds mounted must not wake with it.
//
// Rendered, not source-read: this is the one property of the split a source
// scan cannot see — six hooks over one context, or six contexts behind one
// memo, pass every shape check in `tests/ui-rules/contextSlices.test.ts` and wake
// everything. The wide `useOnlineGame()` probe is the control: it reads all
// six, so it wakes on any of them, and a run where nothing wakes proves
// nothing.
//
// The socket's three slices ride along under the real `SocketProvider`: a
// friend coming online is the hottest field there, and neither the table nor
// an invites-only reader may wake with it.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { useOnlineGame } from './onlineSurface';
import type { RoomState, TurnDeadline } from '@/context/OnlineGameContext';
import type { WireGameState } from '@/shared/protocol';
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
} from '@/context/onlineGameHooks';
import { NotificationProvider } from '@/context/NotificationContext';
import { SocketProvider, useInvites, usePresence, useSocketConnection } from '@/context/SocketContext';

type Listener = (...args: unknown[]) => void;

// A set per event, as socket.io has: the provider registers more than one
// `connect` handler, and a map of one would silently keep only the last.
const listeners = new Map<string, Set<Listener>>();

const mockSocket = {
  connected: true,
  active: true,
  io: { reconnection() {} },
  connect() {},
  disconnect() {},
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

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

jest.mock('expo-router', () => ({
  router: { push: () => {}, replace: () => {}, back: () => {} },
  useSegments: () => ['(online)', 'game'],
}));

const { useOnlineRouting } = require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');

const renders: Record<string, number> = {};

/** One probe per slice, each reading its own and nothing else — and `wide`. */
const PROBES = {
  connection: useOnlineConnection,
  room: useOnlineRoom,
  table: useOnlineTable,
  turnClock: useOnlineTurnClock,
  match: useOnlineMatch,
  exchange: useOnlineExchange,
  // The layout's router, mounted for the whole group: it follows the table
  // appearing and going, never a move.
  router: useOnlineRouting,
  wide: useOnlineGame,
  socket: useSocketConnection,
  presence: usePresence,
  invites: useInvites,
} as const;

function probe(name: keyof typeof PROBES) {
  const useSlice = PROBES[name];
  return function Probe() {
    useSlice();
    renders[name] = (renders[name] ?? 0) + 1;
    return null;
  };
}

// Built once, outside render: a fresh component type on every render would
// remount the probes and count that as a render of its own.
const Probes = Object.keys(PROBES).map((name) => probe(name as keyof typeof PROBES));

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <SocketProvider>
          <OnlineGameProvider userId="u1">
            {Probes.map((P, i) => (
              <P key={i} />
            ))}
          </OnlineGameProvider>
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

const deliver = async (event: string, payload: Broadcast['payloads'][number]) => {
  await act(async () => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });
};

const gameState: Omit<WireGameState, 'viewerSeatIndex' | 'turnSecondsRemaining'> = {
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
};

const roomState: RoomState = {
  roomId: 'R1',
  code: 'R1',
  hostUserId: 'u1',
  status: 'waiting',
  gameMode: 'free_for_all',
  visibility: 'private',
  maxPlayers: 2,
  players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
};

type Broadcast =
  | { event: 'game:turn_deadline'; payloads: [TurnDeadline, TurnDeadline] }
  | { event: 'room:state'; payloads: [RoomState, RoomState] }
  | { event: 'game:state'; payloads: [WireGameState, WireGameState] }
  | { event: 'friend:status'; payloads: [FriendStatus, FriendStatus] };

type FriendStatus = { userId: string; online: boolean };

/**
 * One broadcast per case, delivered twice, and what each slice owes it. The
 * server sends the deadline with the state as well as on its own, so the clock
 * wakes with the table there; the four slices left asleep by a move are what
 * the split is for.
 *
 * Two of a move's four zeros are conditional, not structural: `onGameState`
 * clears a rematch vote unconditionally and announces an exchange as its phase
 * closes, so a state arriving during either wakes that slice. `connection` and
 * `room` sleep through it whatever happens — that handler writes their refs
 * and storage, never their state.
 */
const CASES: (Broadcast & {
  what: string;
  /** Delivered once before counting: what is measured is a table already standing. */
  primed?: boolean;
  expected: Record<keyof typeof PROBES, number>;
})[] = [
  {
    what: 'a turn deadline',
    event: 'game:turn_deadline',
    payloads: [
      { turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
      { turnDeadlineMs: 2000, turnSecondsRemaining: 30 },
    ],
    expected: { connection: 0, room: 0, table: 0, turnClock: 2, match: 0, exchange: 0, router: 0, wide: 2, socket: 0, presence: 0, invites: 0 },
  },
  {
    what: 'a roster change',
    event: 'room:state',
    payloads: [roomState, { ...roomState, players: [] }],
    expected: { connection: 0, room: 2, table: 0, turnClock: 0, match: 0, exchange: 0, router: 2, wide: 2, socket: 0, presence: 0, invites: 0 },
  },
  {
    what: 'a move',
    event: 'game:state',
    primed: true,
    // The same window twice, because `onGameState` re-arms the clock with a
    // fresh object on every broadcast carrying one: the clock wakes on a state
    // that moved nothing about it, and a fixture that varied the numbers could
    // not tell that from a handler that only wrote on a change.
    payloads: [
      { ...gameState, viewerSeatIndex: 0, turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
      { ...gameState, viewerSeatIndex: 0, turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
    ],
    expected: { connection: 0, room: 0, table: 2, turnClock: 2, match: 0, exchange: 0, router: 0, wide: 2, socket: 0, presence: 0, invites: 0 },
  },
  {
    what: 'a friend coming online and going',
    event: 'friend:status',
    payloads: [
      { userId: 'f1', online: true },
      { userId: 'f1', online: false },
    ],
    expected: { connection: 0, room: 0, table: 0, turnClock: 0, match: 0, exchange: 0, router: 0, wide: 0, socket: 0, presence: 2, invites: 0 },
  },
];

describe('a field change wakes its own slice', () => {
  beforeEach(() => {
    listeners.clear();
    for (const key of Object.keys(renders)) delete renders[key];
  });

  for (const { what, event, payloads, expected, primed } of CASES) {
    it(`leaves the slices ${what} says nothing about unrendered`, async () => {
      const view = await mount();
      if (primed) await deliver(event, payloads[0]);
      // Mount settles first: what is measured is the delta a field change
      // costs, not the mount that had to happen either way.
      for (const key of Object.keys(renders)) renders[key] = 0;

      for (const payload of payloads) await deliver(event, payload);

      expect(renders).toEqual(expected);

      await view.unmount();
    });
  }
});
