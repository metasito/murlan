// tests/native/friendsInviteJoin.test.tsx — joining from the friends screen's
// invite row accepts it, which keeps the invite's seat hold: never declined.
// The join then waits on the socket, so the screen says it is joining until
// a room or a refusal answers, and a refusal is told here, where it was asked.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { bannerLog } from './harness/bannerLog';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { route } from './mocks/http';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

const mockDismiss = jest.fn();
const mockAccept = jest.fn();
let mockAccepted: string | null = null;
jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({
    invites: [{ from: 'Besi', roomCode: 'ABC123' }],
    dismiss: mockDismiss,
    accept: mockAccept,
    accepted: mockAccepted,
  }),
}));

let mockLobbyError: { text: string; seq: number } | null = null;
const mockClearError = jest.fn();
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineConnection: () => ({ clearError: mockClearError }),
  useServerError: (surface: string) => (surface === 'lobby' ? mockLobbyError : null),
}));

const { shown, BannerLog } = bannerLog();

import FriendsScreen from '@/app/(online)/friends';
import { en as locale } from '@/locales/en';


const JOINING = locale['onlineLobby.joiningInvite'];

const tree = () => (
  <>
    <BannerLog />
    <FriendsScreen />
  </>
);

async function mount() {
  for (const path of ['/api/friends', '/api/friends/requests', '/api/friends/sent']) route('GET', path, { body: [] });
  await setWindow({ width: 390, height: 844 });
  return renderApp(tree(), { user: { id: 'u1', username: 'Ana' } });
}

describe('joining from a friends-screen invite', () => {
  beforeEach(() => {
    mockAccepted = null;
    mockLobbyError = null;
    shown.length = 0;
    mockClearError.mockClear();
    mockAccept.mockClear();
  });

  it('accepts the invite without declining it', async () => {
    const view = await mount();

    await fireEvent.press(screen.getByLabelText(/join besi/i));

    expect(mockAccept).toHaveBeenCalledWith('ABC123');
    expect(mockDismiss).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('says it is joining, then tells the refusal', async () => {
    const view = await mount();
    expect(screen.queryAllByText(JOINING)).toHaveLength(0);

    mockAccepted = 'ABC123';
    await view.rerender(tree());
    expect(screen.queryAllByText(JOINING).length).toBeGreaterThan(0);

    mockLobbyError = { text: 'That room is full.', seq: 4 };
    mockAccepted = null;
    await view.rerender(tree());

    expect(shown.map((n) => n.message)).toContain('That room is full.');
    expect(mockClearError).toHaveBeenCalledWith(4);
    expect(screen.queryAllByText(JOINING)).toHaveLength(0);
    await view.unmount();
  });
});
