// tests/native/friendsInviteJoin.test.tsx — joining from the friends screen's
// invite row accepts it, which keeps the invite's seat hold: never declined.
// The join then waits on the socket, so the screen says it is joining until
// a room or a refusal answers, and a refusal is told here, where it was asked.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { bannerLog } from './harness/bannerLog';
import { setWindow } from './harness/env';
import { useInvites } from '@/context/SocketContext';
import { useServerError } from '@/context/onlineGameHooks';
import { renderAppHook } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useSegments: () => ['(online)', 'friends'],
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

const { shown, BannerLog } = bannerLog();

import FriendsScreen from '@/app/(online)/friends';
import { en as locale } from '@/locales/en';


const JOINING = locale['onlineLobby.joiningInvite'];

async function mount() {
  for (const path of ['/api/friends', '/api/friends/requests', '/api/friends/sent']) route('GET', path, { body: [] });
  route('GET', '/api/friends/invites', { body: [{ id: 'i1', fromUsername: 'Besi', roomCode: 'ABC123', createdAt: '2026-10-01T10:00:00.000Z' }] });
  await setWindow({ width: 390, height: 844 });
  return renderAppHook(() => ({ accepted: useInvites().accepted, lobbyError: useServerError('lobby') }), {
    user: { id: 'u1', username: 'Ana' },
    online: true,
    follow: true,
    connected: true,
    wrap: (probe) => (
      <>
        <BannerLog />
        <FriendsScreen />
        {probe}
      </>
    ),
  });
}

describe('joining from a friends-screen invite', () => {
  beforeEach(() => {
    shown.length = 0;
  });

  it('accepts the invite without declining it', async () => {
    const view = await mount();

    await fireEvent.press(await screen.findByLabelText(/join besi/i));

    expect(view.socket().sentAs('room:join')).toEqual([expect.objectContaining({ code: 'ABC123' })]);
    expect(view.result.current.accepted).toBe('ABC123');
    expect(httpRequests().filter((r) => r.method === 'DELETE')).toEqual([]);
    await view.unmount();
  });

  it('says it is joining, then tells the refusal', async () => {
    const view = await mount();
    expect(screen.queryAllByText(JOINING)).toHaveLength(0);

    await fireEvent.press(await screen.findByLabelText(/join besi/i));
    expect(screen.queryAllByText(JOINING).length).toBeGreaterThan(0);

    // A code this bundle has no words for, so the server's own text is what the player reads.
    await view.socket().deliver('game:error', { code: 'NEWER_SERVER_REFUSAL', message: 'That room is full.' });
    await act(async () => view.socket().acks.find((a) => a.event === 'room:join')!.answer({ ok: false, code: 'NEWER_SERVER_REFUSAL' }));

    expect(shown.map((n) => n.message)).toContain('That room is full.');
    expect(view.result.current.lobbyError).toBeNull();
    expect(screen.queryAllByText(JOINING)).toHaveLength(0);
    await view.unmount();
  });
});
