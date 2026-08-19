// tests/native/spectateFailed.test.tsx — which teardown event leaving a table
// sends after a spectate attempt the server refused.
//
// `spectateRoom` claims the spectator flag before the server has answered, and
// the flag is what makes `leaveRoom` send `room:unspectate` instead of
// `room:leave`. Left set by a refusal it releases nothing on the next table the
// player actually sits at: the seat keeps being dealt hands and auto-passed
// while their own screen shows the lobby.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';

import { OnlineGameProvider, useOnlineGame } from '@/context/OnlineGameContext';
import { NotificationProvider } from '@/context/NotificationContext';

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

let spectate: ((code: string) => void) | null = null;
let join: ((code: string) => void) | null = null;
let leave: (() => void) | null = null;

function Probe() {
  const { spectateRoom, joinRoom, leaveRoom, isSpectator } = useOnlineGame();
  spectate = spectateRoom;
  join = joinRoom;
  leave = leaveRoom;
  return <Text testID="watching">{String(isSpectator)}</Text>;
}

async function mountProvider() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <OnlineGameProvider userId="u1">
          <Probe />
        </OnlineGameProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

// The provider's own listeners are what the socket calls at runtime. Async
// act(), not the synchronous form: several of these handlers settle a promise
// before they set state, and a sync act() closes before that lands.
const deliver = async (event: string, payload: unknown) => {
  await act(async () => {
    listeners.get(event)?.(payload);
  });
};

/** A sanitized seatless view — what a spectate the server accepted answers with. */
const spectatorState = () => ({
  players: [
    { id: 'p0', name: 'Ana', hand: [], handCount: 13 },
    { id: 'p1', name: 'Bea', hand: [], handCount: 13 },
  ],
  viewerSeatIndex: null,
  currentTurnIndex: 0,
  gameOver: false,
});

describe('a refused spectate', () => {
  beforeEach(async () => {
    emitted.length = 0;
    listeners.clear();
    spectate = null;
    join = null;
    leave = null;
    await AsyncStorage.clear();
  });

  it('leaves the next table by releasing the seat, not by unspectating', async () => {
    const view = await mountProvider();

    await waitFor(() => spectate!('ZZZZZZ'));
    await deliver('room:error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
    await waitFor(() => expect(view.getByTestId('watching').props.children).toBe('false'));

    emitted.length = 0;
    await waitFor(() => leave!());

    expect(emitted.map((e) => e.event)).toContain('room:leave');
    expect(emitted.map((e) => e.event)).not.toContain('room:unspectate');

    await view.unmount();
  });

  // The refusal can be slow, or never rendered at all; taking a seat settles
  // the question on its own.
  it('does not survive into a room the player joins', async () => {
    const view = await mountProvider();

    await waitFor(() => spectate!('ZZZZZZ'));
    await waitFor(() => expect(view.getByTestId('watching').props.children).toBe('true'));

    await waitFor(() => join!('ABCDEF'));
    await waitFor(() => expect(view.getByTestId('watching').props.children).toBe('false'));

    emitted.length = 0;
    await waitFor(() => leave!());

    expect(emitted.map((e) => e.event)).toContain('room:leave');
    expect(emitted.map((e) => e.event)).not.toContain('room:unspectate');

    await view.unmount();
  });

  // The flag still has to do its job for someone who really is watching —
  // `room:leave` from a spectator runs the seated teardown for a table this
  // socket holds no seat at.
  it('leaves a table it is genuinely watching with room:unspectate', async () => {
    const view = await mountProvider();

    await waitFor(() => spectate!('ABCDEF'));
    await deliver('game:state', spectatorState());
    await waitFor(() => expect(view.getByTestId('watching').props.children).toBe('true'));

    emitted.length = 0;
    await waitFor(() => leave!());

    expect(emitted.map((e) => e.event)).toContain('room:unspectate');
    expect(emitted.map((e) => e.event)).not.toContain('room:leave');

    await view.unmount();
  });
});
