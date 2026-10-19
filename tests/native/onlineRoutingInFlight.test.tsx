// tests/native/onlineRoutingInFlight.test.tsx — what the table does while a
// navigation is still landing is judged once it lands.
//
// `useSegments` names the place a navigation left until the router arrives, so
// the router holds off judging that stale place. A table lost in that window
// must still be followed: skipped outright, it leaves the player on a game
// screen's spinner with nothing left to wait for.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockClearRejoinFailed = jest.fn();
const mockState = {
  segments: ['(online)', 'room'],
  roomId: 'r1' as string | null,
  hasGame: false,
  rejoinFailed: false,
};

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: mockPush, back: jest.fn() },
  useSegments: () => mockState.segments,
}));

jest.mock('@/context/SocketContext', () => ({
  useInvites: () => ({ accepted: null, clearAccepted: () => {} }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({
    room: mockState.roomId ? { roomId: mockState.roomId } : null,
    hasGame: mockState.hasGame,
    isSpectator: false,
    entrySource: 'friends',
    joinRoom: () => {},
  }),
  useOnlineConnection: () => ({
    connected: true,
    rejoinFailed: mockState.rejoinFailed,
    clearRejoinFailed: mockClearRejoinFailed,
  }),
}));

const { useOnlineRouting } = require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');

const Router = () => {
  useOnlineRouting();
  return null;
};

describe('a table lost while the room is being replaced by the game', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockClearRejoinFailed.mockClear();
    Object.assign(mockState, { segments: ['(online)', 'room'], roomId: 'r1', hasGame: false, rejoinFailed: false });
  });

  const startThenLose = async (lose: Partial<typeof mockState>) => {
    const view = await render(<Router />);
    mockState.hasGame = true;
    await view.rerender(<Router />);
    expect(mockReplace).toHaveBeenLastCalledWith('/(online)/game');

    Object.assign(mockState, { roomId: null, hasGame: false, ...lose });
    await view.rerender(<Router />);
    mockState.segments = ['(online)', 'game'];
    await view.rerender(<Router />);
    return view;
  };

  it('leaves the game for the lobby once it lands', async () => {
    const view = await startThenLose({});

    expect(mockReplace).toHaveBeenLastCalledWith('/(online)');
    expect(mockReplace).toHaveBeenCalledTimes(2);

    await view.unmount();
  });

  it('acts on a refused rejoin before consuming it', async () => {
    const view = await startThenLose({ rejoinFailed: true });

    expect(mockReplace).toHaveBeenLastCalledWith('/(online)');
    expect(mockClearRejoinFailed).toHaveBeenCalled();
    const replaced = mockReplace.mock.invocationCallOrder.at(-1)!;
    expect(mockClearRejoinFailed.mock.invocationCallOrder[0]).toBeGreaterThan(replaced);

    await view.unmount();
  });
});
