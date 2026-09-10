// tests/native/sliceRenderCounts.test.tsx — a field change wakes one slice.
//
// `armTurn` emits `game:turn_deadline` after every state change, every rejoin
// and every disconnect, so the turn clock is the hottest field on the surface.
// While all six slices read one context, each of those emissions re-rendered
// every consumer of every slice, including lobby screens the router still had
// mounted. What is pinned here is that it no longer does.
//
// Rendered, not source-read: this is the one property of the split that a
// source scan cannot see — the same six hooks over one context pass every
// shape check in `tests/contextSlices.test.ts` and wake everything.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import { OnlineGameProvider } from '@/context/OnlineGameContext';
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

/** One probe per slice, each reading its own and nothing else. */
const PROBES = {
  connection: useOnlineConnection,
  room: useOnlineRoom,
  table: useOnlineTable,
  turnClock: useOnlineTurnClock,
  match: useOnlineMatch,
  exchange: useOnlineExchange,
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

describe('a turn-deadline change wakes only the turn clock', () => {
  beforeEach(() => {
    listeners.clear();
    for (const key of Object.keys(renders)) delete renders[key];
  });

  it('leaves the other five slices unrendered', async () => {
    const view = await mount();
    // Mount settles first: what is measured is the delta a field change costs,
    // not the mount that had to happen either way.
    for (const key of Object.keys(renders)) renders[key] = 0;

    await deliver('game:turn_deadline', { turnDeadlineMs: 1000, turnSecondsRemaining: 30 });
    await deliver('game:turn_deadline', { turnDeadlineMs: 2000, turnSecondsRemaining: 30 });

    expect(renders).toEqual({
      connection: 0,
      room: 0,
      table: 0,
      turnClock: 2,
      match: 0,
      exchange: 0,
    });

    await view.unmount();
  });
});
