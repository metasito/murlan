// tests/native/roomInviteAndShare.test.tsx — the room's invite panel marks an
// invite sent only when the server says so, and Share never fails silently.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Platform, Share } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { en as locale } from '@/locales/en';

type Ack = (err: unknown, reply?: { ok: boolean; code?: string }) => void;
const mockAcks: Ack[] = [];
const mockSocket = {
  emit: jest.fn(),
  timeout: () => ({
    emit: (_event: string, _payload: unknown, ack: Ack) => {
      mockAcks.push(ack);
    },
  }),
};

const mockShowNotification = jest.fn();
const mockSetString = jest.fn(async (_s: string) => true);
let mockFriendsQuery: Record<string, unknown>;

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (s: string) => mockSetString(s),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'host', username: 'Ana' } }),
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: mockSocket, onlineIds: new Set(['f1']) }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
  useBannerBottom: () => 0,
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => mockFriendsQuery,
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

const INVITE = locale['room.inviteA11yLabel'].replace('{{username}}', 'Besi');
const SENT = locale['room.inviteSentA11yLabel'].replace('{{username}}', 'Besi');

function renderRoom() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RoomScreen />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockAcks.length = 0;
  mockShowNotification.mockClear();
  mockSetString.mockClear();
  mockFriendsQuery = { data: [{ id: 'f1', username: 'Besi', lastSeen: null }], isLoading: false, isError: false };
});

describe('the invite panel waits for the server', () => {
  it('shows sent only once the server acknowledges ok', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(INVITE));
    expect(view.queryByLabelText(SENT)).toBeNull();
    await act(async () => mockAcks[0](null, { ok: true, code: 'INVITE_SHOWN' }));
    expect(view.getByLabelText(SENT)).toBeTruthy();
    await view.unmount();
  });

  it('resets the row when the server refuses', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(INVITE));
    await act(async () => mockAcks[0](null, { ok: false, code: 'NOT_FRIENDS' }));
    expect(view.queryByLabelText(SENT)).toBeNull();
    expect(view.getByLabelText(INVITE)).toBeTruthy();
    await view.unmount();
  });

  it('resets the row when no answer arrives', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(INVITE));
    await act(async () => mockAcks[0](new Error('timeout')));
    expect(view.getByLabelText(INVITE)).toBeTruthy();
    await view.unmount();
  });

  it('says the friends list failed to load, with a retry', async () => {
    const refetch = jest.fn();
    mockFriendsQuery = { data: undefined, isLoading: false, isError: true, refetch };
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['friends.loadRetryA11yLabel']));
    expect(refetch).toHaveBeenCalled();
    expect(view.queryByText(locale['room.noFriendsOnline'])).toBeNull();
    await view.unmount();
  });

  it('says the friends list is loading rather than empty', async () => {
    mockFriendsQuery = { data: undefined, isLoading: true, isError: false };
    const view = await renderRoom();
    expect(view.queryByText(locale['room.noFriendsOnline'])).toBeNull();
    expect(view.getAllByLabelText(locale['common.loading']).length).toBeGreaterThan(0);
    await view.unmount();
  });
});

describe('share', () => {
  it('ignores a share the player dismissed', async () => {
    const spy = jest.spyOn(Share, 'share').mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(mockShowNotification).not.toHaveBeenCalled();
    spy.mockRestore();
    await view.unmount();
  });

  it('reports a share that failed', async () => {
    const spy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('boom'));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(mockShowNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_error', message: locale['room.shareFailed'] }));
    spy.mockRestore();
    await view.unmount();
  });

  it('copies the code on a web browser with no share sheet', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    const spy = jest.spyOn(Share, 'share');
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetString).toHaveBeenCalledWith('ABCDEF');
    spy.mockRestore();
    os.restore();
    await view.unmount();
  });

  it('reports a copy that failed', async () => {
    mockSetString.mockRejectedValueOnce(new Error('denied'));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['common.copy']));
    expect(mockShowNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_error', message: locale['room.copyFailed'] }));
    await view.unmount();
  });
});
