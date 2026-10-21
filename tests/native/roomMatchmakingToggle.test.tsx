// tests/native/roomMatchmakingToggle.test.tsx — the room screen's two host
// switches: the one that opens the room to strangers, and the one that fills
// it with bots.
//
// A source scan cannot tell a rendered control from a defined one, and the
// whole point of both is what they emit, so this renders the screen.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, act } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';

import { en as locale } from '@/locales/en';

const mockSetRoomVisibility = jest.fn();

let mockRoom: Record<string, unknown>;
let mockRoomScreenRenders = 0;

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  useSocketConnection: () => null,
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({ send: async () => false }),
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<object>('@tanstack/react-query'),
  useQuery: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => {
    mockRoomScreenRenders += 1;
    return {
    room: mockRoom,
    entrySource: 'friends',
    leaveRoom: jest.fn(),
    startGame: jest.fn(),
    setRoomVisibility: mockSetRoomVisibility,
    };
  },
  useOnlineTable: () => ({ gameState: null }),
  useOnlineConnection: () => ({ connected: true, clearError: jest.fn() }),
  useServerError: () => null,
}));

const roomModule = require('@/app/(online)/room') as {
  default: React.ComponentType;
  BOTS_OFFERED_AFTER_MS: number;
};
const RoomScreen = roomModule.default;
const { BOTS_OFFERED_AFTER_MS } = roomModule;
const COUNTDOWN_STEP_MS = 1_000;


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

async function renderRoom() {
  await setWindow({ width: 390, height: 844 });
  return renderApp(<RoomScreen />, { user: { id: 'host', username: 'Ana' } });
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

  it('says when bots will be offered, so the wait reads as finite', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderRoom();
      const hint = (seconds: number) =>
        locale['room.botsComingIn'].replace('{{seconds}}', String(seconds));

      await act(async () => {
        jest.advanceTimersByTime(COUNTDOWN_STEP_MS);
      });
      expect(view.getByText(hint(29))).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(BOTS_OFFERED_AFTER_MS - COUNTDOWN_STEP_MS);
      });
      expect(view.queryByText(hint(0))).toBeNull();
      expect(view.getByRole('switch', { name: BOTS })).toBeTruthy();

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not offer bots until the host has actually been kept waiting', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderRoom();
      expect(view.queryByRole('switch', { name: BOTS })).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(BOTS_OFFERED_AFTER_MS - 1);
      });
      expect(view.queryByRole('switch', { name: BOTS })).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(view.getByRole('switch', { name: BOTS, checked: false })).toBeTruthy();

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('counts down without re-rendering the room screen', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderRoom();
      const hint = (seconds: number) =>
        locale['room.botsComingIn'].replace('{{seconds}}', String(seconds));
      const rendersBefore = mockRoomScreenRenders;

      for (let tick = 0; tick < 5; tick++) {
        await act(async () => {
          jest.advanceTimersByTime(COUNTDOWN_STEP_MS);
        });
      }
      expect(view.getByText(hint(25))).toBeTruthy();
      expect(mockRoomScreenRenders).toBe(rendersBefore);

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows no countdown to a player who is not the host', async () => {
    jest.useFakeTimers();
    try {
      mockRoom = { ...roomWith('private'), players: [{ seatIndex: 0, userId: 'host', username: 'Ana' }, { seatIndex: 1, userId: 'guest', username: 'Bo' }] };
      await setWindow({ width: 390, height: 844 });
      const view = await renderApp(<RoomScreen />, { user: { id: 'guest', username: 'Bo' } });
      const rendersBefore = mockRoomScreenRenders;
      for (let tick = 0; tick < 5; tick++) {
        await act(async () => {
          jest.advanceTimersByTime(COUNTDOWN_STEP_MS);
        });
      }
      const anyCountdown = new RegExp(
        locale['room.botsComingIn'].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('{{seconds}}', '\\d+')
      );
      expect(view.queryByText(anyCountdown)).toBeNull();
      expect(mockRoomScreenRenders).toBe(rendersBefore);
      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
