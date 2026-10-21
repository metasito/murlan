// tests/native/rejoinFailedExit.test.tsx — how the online router leaves a
// table the server refused to let the player back into.
//
// It must navigate without emitting `room:leave`: mid-game that reaches
// handleLeaveRoom and vacates the seat on the spot, ahead of the 60s
// disconnect grace that owns it. A refused rejoin is not the player leaving.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, waitFor } from '@testing-library/react-native';
import { useOnlineConnection } from '@/context/onlineGameHooks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACTIVE_ROOM_KEY } from '@/lib/storageKeys';
import { renderApp } from './harness/renderApp';

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockSegments = ['(online)', 'game'];

jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useSegments: () => mockSegments,
}));

const { useOnlineRouting } = require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');

let flags: boolean[] = [];

const Router = () => {
  useOnlineRouting();
  flags.push(useOnlineConnection().rejoinFailed);
  return null;
};

/** A cold start holding the table the player sat at, the rejoin it sends, and the server refusing. */
async function refusedRejoin() {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'R1');
  const view = await renderApp(<Router />, { user: { id: 'u1', username: 'Ana' }, online: true });
  await act(async () => view.socket().drop('transport close'));
  await act(async () => view.socket().open());
  expect(view.socket().sentAs('game:rejoin').at(-1)).toMatchObject({ roomId: 'R1' });
  mockReplace.mockClear();
  mockPush.mockClear();
  view.socket().reset();
  flags = [];
  await view.socket().deliver('game:rejoin_failed', { roomId: 'R1', code: 'ROOM_NOT_FOUND', message: 'gone' });
  return view;
}

const consumed = () => flags.includes(true) && flags.at(-1) === false;

describe('a refused rejoin', () => {
  beforeEach(() => {
    mockSegments = ['(online)', 'game'];
  });

  it('returns to the lobby without releasing the seat', async () => {
    const view = await refusedRejoin();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(online)'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(view.socket().sentAs('room:leave')).toHaveLength(0);

    await view.unmount();
  });

  // The flag outlives the screen that was on when it latched — the provider
  // sits above the route group. Whatever the player opens next, a game or a
  // spectated table, is bounced straight back out unless the bounce is consumed.
  it('consumes the flag on the way out', async () => {
    const view = await refusedRejoin();

    await waitFor(() => expect(consumed()).toBe(true));

    await view.unmount();
  });

  it('consumes the flag where the player is, and moves nobody off a lobby', async () => {
    mockSegments = ['(online)'];
    const view = await refusedRejoin();

    await waitFor(() => expect(consumed()).toBe(true));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await view.unmount();
  });
});
