// tests/native/rejoinFailedExit.test.tsx — how the online router leaves a
// table the server refused to let the player back into.
//
// It must navigate without emitting `room:leave`: mid-game that reaches
// handleLeaveRoom and vacates the seat on the spot, ahead of the 60s
// disconnect grace that owns it. A refused rejoin is not the player leaving.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockLeaveRoom = jest.fn();
const mockClearRejoinFailed = jest.fn();
let mockSegments = ['(online)', 'game'];

jest.mock('expo-router', () => ({
  router: { replace: mockReplace, push: mockPush, back: jest.fn() },
  useSegments: () => mockSegments,
}));

jest.mock('@/context/SocketContext', () => ({
  useInvites: () => ({ accepted: null, clearAccepted: jest.fn() }),
}));

jest.mock('@/context/OnlineGameContext', () =>
  (require('./onlineContextMock') as typeof import('./onlineContextMock')).onlineContextMock(
    () => ({
      // A failed rejoin has already cleared the state.
      room: null,
      gameState: null,
      hasGame: false,
      isSpectator: false,
      rejoinFailed: true,
      connected: true,
      leaveRoom: mockLeaveRoom,
      joinRoom: jest.fn(),
      entrySource: null,
      clearRejoinFailed: mockClearRejoinFailed,
    })
  )
);

const { useOnlineRouting } = require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');

const Router = () => {
  useOnlineRouting();
  return null;
};

describe('a refused rejoin', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockLeaveRoom.mockClear();
    mockClearRejoinFailed.mockClear();
    mockSegments = ['(online)', 'game'];
  });

  it('returns to the lobby without releasing the seat', async () => {
    const view = await render(<Router />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(online)'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockLeaveRoom).not.toHaveBeenCalled();

    await view.unmount();
  });

  // The flag outlives the screen that was on when it latched — the provider
  // sits above the route group. Whatever the player opens next, a game or a
  // spectated table, is bounced straight back out unless the bounce is consumed.
  it('consumes the flag on the way out', async () => {
    const view = await render(<Router />);

    await waitFor(() => expect(mockClearRejoinFailed).toHaveBeenCalled());

    await view.unmount();
  });

  it('consumes the flag where the player is, and moves nobody off a lobby', async () => {
    mockSegments = ['(online)'];
    const view = await render(<Router />);

    await waitFor(() => expect(mockClearRejoinFailed).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await view.unmount();
  });
});
