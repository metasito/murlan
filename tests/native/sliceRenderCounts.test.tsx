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
import {
  useOnlineConnection,
  useOnlineExchange,
  useOnlineMatch,
  useOnlineRoom,
  useOnlineTable,
  useOnlineTurnClock,
} from '@/context/onlineGameHooks';
import { NotificationProvider } from '@/context/NotificationContext';

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

const deliver = async (event: string, payload: unknown) => {
  await act(async () => {
    listeners.get(event)?.(payload);
  });
};

const roomState = {
  roomId: 'R1',
  code: 'R1',
  hostUserId: 'u1',
  status: 'waiting' as const,
  gameMode: 'free_for_all' as const,
  maxPlayers: 2,
  players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
};

describe('a field change wakes its own slice', () => {
  beforeEach(() => {
    listeners.clear();
    for (const key of Object.keys(renders)) delete renders[key];
  });

  // Mount settles first: what is measured is the delta a field change costs,
  // not the mount that had to happen either way.
  const settled = async () => {
    const view = await mount();
    for (const key of Object.keys(renders)) renders[key] = 0;
    return view;
  };

  it('leaves the five slices a turn deadline says nothing about unrendered', async () => {
    const view = await settled();

    await deliver('game:turn_deadline', { turnDeadlineMs: 1000, turnSecondsRemaining: 30 });
    await deliver('game:turn_deadline', { turnDeadlineMs: 2000, turnSecondsRemaining: 30 });

    expect(renders).toEqual({
      connection: 0,
      room: 0,
      table: 0,
      turnClock: 2,
      match: 0,
      exchange: 0,
      wide: 2,
    });

    await view.unmount();
  });

  // The other direction, and the one the lobby screens pay for: `room:state`
  // arrives on every roster change a waiting table has.
  it('leaves the five slices a room change says nothing about unrendered', async () => {
    const view = await settled();

    await deliver('room:state', roomState);
    await deliver('room:state', { ...roomState, players: [] });

    expect(renders).toEqual({
      connection: 0,
      room: 2,
      table: 0,
      turnClock: 0,
      match: 0,
      exchange: 0,
      wide: 2,
    });

    await view.unmount();
  });
});
