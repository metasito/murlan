// tests/native/friendSearchFailure.test.tsx — a search that never reached the
// server says so; only the server's 404 says the user does not exist.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { route, unreachable, type HttpReply } from './mocks/http';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({ invites: [], dismiss: jest.fn(), accept: jest.fn() }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
  useOnlineConnection: () => ({ error: null }),
  useServerError: () => null,
}));


import FriendsScreen from '@/app/(online)/friends';


async function searchFailingWith(answer: HttpReply | typeof unreachable) {
  route('GET', '/api/users/search', answer);
  for (const path of ['/api/friends', '/api/friends/requests', '/api/friends/sent']) route('GET', path, { body: [] });
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(<FriendsScreen />, { user: { id: 'u1', username: 'Ana' } });
  await fireEvent.changeText(screen.getByPlaceholderText(locale['friends.usernamePlaceholder']), 'ghost');
  await fireEvent.press(screen.getByRole('button', { name: locale['friends.searchButtonA11yLabel'] }));
  return view;
}

describe('friend search failure', () => {
  it('a dropped connection says the search failed, not that the user is missing', async () => {
    const view = await searchFailingWith(unreachable);
    expect(await screen.findByText(locale['friends.searchFailed'])).toBeTruthy();
    expect(screen.queryByText(locale['friends.userNotFound'])).toBeNull();
    await view.unmount();
  });

  it("the server's 404 says the user was not found", async () => {
    const view = await searchFailingWith({ status: 404, body: 'not found' });
    expect(await screen.findByText(locale['friends.userNotFound'])).toBeTruthy();
    expect(screen.queryByText(locale['friends.searchFailed'])).toBeNull();
    await view.unmount();
  });
});
