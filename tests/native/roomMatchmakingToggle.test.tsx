// tests/native/roomMatchmakingToggle.test.tsx — the room screen's two host
// switches: the one that opens the room to strangers, and the one that fills
// it with bots.
//
// A source scan cannot tell a rendered control from a defined one, and the
// whole point of both is what they emit, so this renders the screen.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

const mockSetRoomVisibility = jest.fn();

let mockRoom: Record<string, unknown>;

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
    room: mockRoom,
    entrySource: 'friends',
    leaveRoom: jest.fn(),
    startGame: jest.fn(),
    setRoomVisibility: mockSetRoomVisibility,
  }),
  useOnlineTable: () => ({ gameState: null }),
  useOnlineConnection: () => ({ error: null, clearError: jest.fn() }),
}));

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const MATCHMAKING = locale['room.fillWithMatchmakingA11yLabel'];
const BOTS = locale['room.fillWithBotsA11yLabel'];

function roomWith(visibility: string) {
  return {
    roomId: 'r1',
    code: 'ABCDEF',
    hostUserId: 'host',
    status: 'waiting',
    gameMode: 'free_for_all',
    maxPlayers: 4,
    visibility,
    players: [{ seatIndex: 0, userId: 'host', username: 'Ana' }],
    seatHolds: [],
  };
}

function renderRoom() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RoomScreen />
    </SafeAreaProvider>
  );
}

describe('the room screen matchmaking toggle', () => {
  beforeEach(() => {
    mockSetRoomVisibility.mockClear();
    mockRoom = roomWith('private');
  });

  it('reads off the room rather than off a local copy of it', async () => {
    const closed = await renderRoom();
    expect(closed.getByRole('switch', { name: MATCHMAKING, checked: false })).toBeTruthy();
    await closed.unmount();

    mockRoom = roomWith('public');
    const open = await renderRoom();
    expect(open.getByRole('switch', { name: MATCHMAKING, checked: true })).toBeTruthy();
    await open.unmount();
  });

  it('asks the server to open the room, and to close it again', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByRole('switch', { name: MATCHMAKING }));
    expect(mockSetRoomVisibility).toHaveBeenCalledWith('public');
    await view.unmount();

    mockSetRoomVisibility.mockClear();
    mockRoom = roomWith('public');
    const opened = await renderRoom();
    await fireEvent.press(opened.getByRole('switch', { name: MATCHMAKING }));
    expect(mockSetRoomVisibility).toHaveBeenCalledWith('private');
    await opened.unmount();
  });

  it('does not offer bots until the host has actually been kept waiting', async () => {
    const view = await renderRoom();
    expect(view.queryByRole('switch', { name: BOTS })).toBeNull();

    await view.unmount();
  });
});
