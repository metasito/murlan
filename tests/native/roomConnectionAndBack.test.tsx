// tests/native/roomConnectionAndBack.test.tsx — the waiting room while the
// socket is down, and every way off it. Start and the visibility switch send
// intents, so neither is live without a connection, and the screen says why.
// Back by any route asks the same question as the header's back button; the
// guard steps aside once the room is gone or a game exists, since the router
// replaces away from the room then and a held guard would trap the player.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { BackHandler, Platform } from 'react-native';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

const mockLeaveRoom = jest.fn();
const mockStartGame = jest.fn();
let mockRoom: Record<string, unknown> | null;
let mockHasGame = false;
let mockConnected = true;
type Prevented = { data: { action: { type: string } } };
const mockGuard: { prevent: boolean | null; onPrevented: ((e: Prevented) => void) | null } = {
  prevent: null,
  onPrevented: null,
};
const POP: Prevented = { data: { action: { type: 'POP' } } };

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, onPrevented: (e: Prevented) => void) => {
    mockGuard.prevent = prevent;
    mockGuard.onPrevented = onPrevented;
  },
}));

const mockBrowserBack: { active: boolean | null; onBack: (() => void) | null } = { active: null, onBack: null };
jest.mock('@/lib/browserBack', () => ({
  useBrowserBackGuard: (active: boolean, onBack: () => void) => {
    mockBrowserBack.active = active;
    mockBrowserBack.onBack = onBack;
  },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'host', username: 'Ana' } }),
}));

jest.mock('@/context/SocketContext', () => ({
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({ send: async () => false }),
}));

jest.mock('@/context/NotificationContext', () =>
  (require('./helpers/notificationMock') as typeof import('./helpers/notificationMock')).notificationContextMock()
);

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<object>('@tanstack/react-query'),
  useQuery: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({
    room: mockRoom,
    hasGame: mockHasGame,
    isSpectator: false,
    entrySource: 'friends',
    leaveRoom: mockLeaveRoom,
    startGame: mockStartGame,
    setRoomVisibility: jest.fn(),
  }),
  useOnlineConnection: () => ({ connected: mockConnected, rejoinFailed: false, clearError: jest.fn() }),
  useServerError: () => null,
}));

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const START = locale['room.startGame'];
const MATCHMAKING = locale['room.fillWithMatchmakingA11yLabel'];

const twoSeated = () => ({
  roomId: 'r1',
  code: 'ABCDEF',
  hostUserId: 'host',
  status: 'waiting',
  gameMode: 'free_for_all',
  maxPlayers: 4,
  visibility: 'private',
  players: [
    { seatIndex: 0, userId: 'host', username: 'Ana' },
    { seatIndex: 1, userId: 'b', username: 'Besi' },
  ],
  seatHolds: [],
});

const tree = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <RoomScreen />
  </SafeAreaProvider>
);

beforeEach(() => {
  mockRoom = twoSeated();
  mockHasGame = false;
  mockConnected = true;
  mockGuard.prevent = null;
  mockGuard.onPrevented = null;
  mockBrowserBack.active = null;
  mockBrowserBack.onBack = null;
  mockLeaveRoom.mockClear();
  mockStartGame.mockClear();
});

describe('the waiting room without a connection', () => {
  it('says it is connecting and holds Start and the visibility switch', async () => {
    mockConnected = false;
    const view = await render(tree());

    expect(screen.getByText(locale['onlineLobby.connecting'])).toBeTruthy();
    expect(screen.getByRole('button', { name: START })).toBeDisabled();
    expect(screen.getByRole('switch', { name: MATCHMAKING })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: START }));
    expect(mockStartGame).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('frees both once connected', async () => {
    const view = await render(tree());

    expect(screen.queryByText(locale['onlineLobby.connecting'])).toBeNull();
    expect(screen.getByRole('button', { name: START })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: MATCHMAKING })).not.toBeDisabled();
    await view.unmount();
  });
});

describe('back on the waiting room', () => {
  it('asks the leave question, and leaves only on confirm', async () => {
    const view = await render(tree());
    expect(mockGuard.prevent).toBe(true);

    await act(async () => mockGuard.onPrevented!(POP));
    await fireEvent.press(screen.getByLabelText(locale['common.cancel']));
    expect(mockLeaveRoom).not.toHaveBeenCalled();

    await act(async () => mockGuard.onPrevented!(POP));
    await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
    expect(mockLeaveRoom).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("answers the browser's back with the same question, under the same guard", async () => {
    const view = await render(tree());
    expect(mockBrowserBack.active).toBe(true);

    await act(async () => mockBrowserBack.onBack!());
    await fireEvent.press(screen.getByLabelText(locale['common.cancel']));
    expect(mockLeaveRoom).not.toHaveBeenCalled();

    await act(async () => mockBrowserBack.onBack!());
    await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
    expect(mockLeaveRoom).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('lets the router replace the room once a game exists or the room is gone', async () => {
    const view = await render(tree());
    mockHasGame = true;
    await view.rerender(tree());
    expect(mockGuard.prevent).toBe(false);
    expect(mockBrowserBack.active).toBe(false);

    mockHasGame = false;
    mockRoom = null;
    await view.rerender(tree());
    expect(mockGuard.prevent).toBe(false);
    expect(mockBrowserBack.active).toBe(false);
    await view.unmount();
  });

  it('answers the Android back button with the same question', async () => {
    const listeners: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      listeners.push(handler);
      return {
        remove: () => {
          listeners.splice(listeners.indexOf(handler), 1);
        },
      };
    });
    try {
      const view = await render(tree());
      if (Platform.OS !== 'android') {
        expect(listeners).toHaveLength(0);
        await view.unmount();
        return;
      }
      expect(listeners).toHaveLength(1);
      let handled: boolean | null | undefined;
      await act(async () => {
        handled = listeners[0]({ type: 'hardwareBackPress', timeStamp: 0 });
      });
      expect(handled).toBe(true);
      await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
      expect(mockLeaveRoom).toHaveBeenCalledTimes(1);

      mockRoom = null;
      await view.rerender(tree());
      expect(listeners).toHaveLength(0);
      await view.unmount();
    } finally {
      spy.mockRestore();
    }
  });
});
