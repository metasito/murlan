import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockRelease = jest.fn();
const mockHoldSounds = jest.fn(() => mockRelease);
const mockPreloadSounds = jest.fn(async () => {});

jest.mock('@/lib/sounds', () => ({
  ...(jest.requireActual('@/lib/sounds') as object),
  holdSounds: mockHoldSounds,
  preloadSounds: mockPreloadSounds,
  ensureAudioMode: jest.fn(async () => {}),
}));

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'host', username: 'Ana' } }),
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
  useBannerBottom: () => 0,
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({
    room: {
      roomId: 'r1',
      code: 'ABCDEF',
      hostUserId: 'host',
      status: 'waiting',
      gameMode: 'free_for_all',
      maxPlayers: 4,
      visibility: 'private',
      players: [{ seatIndex: 0, userId: 'host', username: 'Ana' }],
      seatHolds: [],
    },
    entrySource: 'friends',
    leaveRoom: jest.fn(),
    startGame: jest.fn(),
    setRoomVisibility: jest.fn(),
  }),
  useOnlineTable: () => ({ gameState: null }),
  useOnlineConnection: () => ({ error: null, clearError: jest.fn() }),
}));

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe('the room screen and its sounds', () => {
  it('holds and preloads the sounds while mounted, and releases them on leaving', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RoomScreen />
      </SafeAreaProvider>
    );
    expect(mockHoldSounds).toHaveBeenCalledTimes(1);
    expect(mockPreloadSounds).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
    await view.unmount();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
