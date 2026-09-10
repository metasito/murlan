// tests/native/sliceRenderCounts.test.tsx — a field change wakes one slice.
//
// `armTurn` emits `game:turn_deadline` after every state change, every rejoin
// and every disconnect, so the turn clock is the hottest field on the surface,
// and the online screens the router holds mounted must not wake with it.
//
// Rendered, not source-read: this is the one property of the split a source
// scan cannot see — six hooks over one context, or six contexts behind one
// memo, pass every shape check in `tests/contextSlices.test.ts` and wake
// everything. The wide `useOnlineGame()` probe is the control: it reads all
// six, so it wakes on any of them, and a run where nothing wakes proves
// nothing.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import { OnlineGameProvider, useOnlineGame } from '@/context/OnlineGameContext';
import type { GameStateBroadcast, RoomState, TurnDeadline } from '@/context/OnlineGameContext';
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
} from '@/context/onlineGameHooks';
import { NotificationProvider } from '@/context/NotificationContext';
import type { GameState } from '@/lib/gameEngine';

type Listener = (...args: unknown[]) => void;

const listeners = new Map<string, Listener>();

const mockSocket = {
  connected: true,
  on(event: string, fn: Listener) {
    listeners.set(event, fn);
  },
  off() {},
  emit() {},
};

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket }),
}));

const renders: Record<string, number> = {};

/** One probe per slice, each reading its own and nothing else — and `wide`. */
const PROBES = {
  connection: useOnlineConnection,
  room: useOnlineRoom,
  table: useOnlineTable,
  turnClock: useOnlineTurnClock,
  match: useOnlineMatch,
  exchange: useOnlineExchange,
  wide: useOnlineGame,
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
        <OnlineGameProvider userId="u1">
          {Probes.map((P, i) => (
            <P key={i} />
          ))}
        </OnlineGameProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

const deliver = async (event: string, payload: Broadcast['payloads'][number]) => {
  await act(async () => {
    listeners.get(event)?.(payload);
  });
};

const gameState: GameState = {
  players: [
    { id: 'player_0', name: 'Ana', hand: [], type: 'human' },
    { id: 'player_1', name: 'Besi', hand: [], type: 'human' },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
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

/**
 * One broadcast per case, delivered twice, and what each slice owes it. The
 * server sends the deadline with the state as well as on its own, so the clock
 * wakes with the table there; the four slices left asleep by a move are what
 * the split is for.
 *
 * `match` is asleep here because no rematch vote is outstanding — `onGameState`
 * clears one unconditionally, so a state arriving during a vote does wake it.
 */
type Broadcast =
  | { event: 'game:turn_deadline'; payloads: [TurnDeadline, TurnDeadline] }
  | { event: 'room:state'; payloads: [RoomState, RoomState] }
  | { event: 'game:state'; payloads: [GameStateBroadcast, GameStateBroadcast] };

const CASES: (Broadcast & {
  what: string;
  expected: Record<keyof typeof PROBES, number>;
})[] = [
  {
    what: 'a turn deadline',
    event: 'game:turn_deadline',
    payloads: [
      { turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
      { turnDeadlineMs: 2000, turnSecondsRemaining: 30 },
    ],
    expected: { connection: 0, room: 0, table: 0, turnClock: 2, match: 0, exchange: 0, wide: 2 },
  },
  {
    what: 'a roster change',
    event: 'room:state',
    payloads: [roomState, { ...roomState, players: [] }],
    expected: { connection: 0, room: 2, table: 0, turnClock: 0, match: 0, exchange: 0, wide: 2 },
  },
  {
    what: 'a move',
    event: 'game:state',
    // The same window twice, because `onGameState` re-arms the clock with a
    // fresh object on every broadcast carrying one: the clock wakes on a state
    // that moved nothing about it, and a fixture that varied the numbers could
    // not tell that from a handler that only wrote on a change.
    payloads: [
      { ...gameState, viewerSeatIndex: 0, turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
      { ...gameState, viewerSeatIndex: 0, turnDeadlineMs: 1000, turnSecondsRemaining: 30 },
    ],
    expected: { connection: 0, room: 0, table: 2, turnClock: 2, match: 0, exchange: 0, wide: 2 },
  },
];

describe('a field change wakes its own slice', () => {
  beforeEach(() => {
    listeners.clear();
    for (const key of Object.keys(renders)) delete renders[key];
  });

  for (const { what, event, payloads, expected } of CASES) {
    it(`leaves the slices ${what} says nothing about unrendered`, async () => {
      const view = await mount();
      // Mount settles first: what is measured is the delta a field change
      // costs, not the mount that had to happen either way.
      for (const key of Object.keys(renders)) renders[key] = 0;

      for (const payload of payloads) await deliver(event, payload);

      expect(renders).toEqual(expected);

      await view.unmount();
    });
  }
});
