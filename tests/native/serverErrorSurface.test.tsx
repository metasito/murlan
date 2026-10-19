// tests/native/serverErrorSurface.test.tsx — a server refusal belongs to the
// surface it answered, and is worded in the language on screen when it is read.
//
// The real provider and the real room screen: every online screen the router
// holds can be mounted at once, and what this pins is that one of them cannot
// consume what another is showing.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockShowNotification = jest.fn();
const mockSocketListeners = new Map<string, Set<(payload: unknown) => void>>();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' } }),
}));

jest.mock('@/context/SocketContext', () => {
  const socket = {
    connected: true,
    on: (event: string, fn: (payload: unknown) => void) => {
      if (!mockSocketListeners.has(event)) mockSocketListeners.set(event, new Set());
      mockSocketListeners.get(event)!.add(fn);
    },
    off: (event: string, fn: (payload: unknown) => void) => mockSocketListeners.get(event)?.delete(fn),
    once: () => {},
    timeout: () => socket,
    emit: () => {},
  };
  return { useSocket: () => ({ socket }) };
});

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
  useBannerBottom: () => 0,
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<object>('@tanstack/react-query'),
  useQuery: () => ({ data: [], isLoading: false }),
}));

import { OnlineGameProvider } from '@/context/OnlineGameContext';
import { useServerError } from '@/context/onlineGameHooks';
import { setLocale } from '@/lib/i18n';
import { en } from '@/locales/en';
import { sq } from '@/locales/sq';

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const ROOM = {
  roomId: 'r1',
  code: 'ABCDEF',
  hostUserId: 'u1',
  status: 'waiting',
  gameMode: 'free_for_all',
  maxPlayers: 4,
  visibility: 'private',
  players: [{ seatIndex: 0, userId: 'u1', username: 'Ana' }],
  seatHolds: [],
};

const emit = (event: string, payload: unknown) =>
  act(async () => mockSocketListeners.get(event)?.forEach((fn) => fn(payload)));

function LobbyProbe() {
  return <Text testID="lobby-error">{useServerError('lobby')?.text ?? ''}</Text>;
}
const lobbyError = () => screen.getByTestId('lobby-error').props.children;

const mount = (child?: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OnlineGameProvider userId="u1">
        <SafeAreaProvider initialMetrics={METRICS}>
          <LobbyProbe />
          {child}
        </SafeAreaProvider>
      </OnlineGameProvider>
    </QueryClientProvider>
  );

beforeEach(() => {
  mockShowNotification.mockClear();
  mockSocketListeners.clear();
});
afterEach(async () => {
  await act(() => setLocale('en'));
});

describe('a server refusal', () => {
  it("is the lobby's when no room answered it, and the room screen neither toasts nor clears it", async () => {
    const r = await mount(<RoomScreen />);
    await emit('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    await emit('room:state', ROOM);
    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(lobbyError()).toBe(en['server.ROOM_NOT_FOUND']);
    await r.unmount();
  });

  it("is the room's once a room is held, toasted there once and kept off the lobby", async () => {
    const r = await mount(<RoomScreen />);
    await emit('room:state', ROOM);
    await emit('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    expect(mockShowNotification.mock.calls[0]?.[0]).toMatchObject({ message: en['server.ROOM_NOT_FOUND'] });
    expect(lobbyError()).toBe('');
    await r.unmount();
  });

  it('standing, is reworded when the language changes', async () => {
    const r = await mount();
    await emit('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    expect(lobbyError()).toBe(en['server.ROOM_NOT_FOUND']);
    await act(() => setLocale('sq'));
    expect(lobbyError()).toBe(sq['server.ROOM_NOT_FOUND']);
    await r.unmount();
  });
});
