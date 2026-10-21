// tests/native/friendsPresenceRow.test.tsx — the friends list pairs a
// colour-only presence dot (Avatar's `online ? Colors.success :
// Colors.textMuted`, no shape or icon difference) with a status text
// ("● Online" / "Seen X ago") right beside it — the same non-colour channel
// tests/native/onlineStatusRow.test.tsx already pins for the online lobby's
// header. Disproved by the reviewer: setting `rowSub` to `opacity: 0` in
// app/(online)/friends.tsx left the full native suite green, 202/202 suites,
// because nothing read the row's resolved style.
import { describe, it, jest } from '@jest/globals';
import React from 'react';
import { screen } from '@testing-library/react-native';

import { setWindow } from './harness/env';
import { queriesSettled, renderApp } from './harness/renderApp';
import { route } from './mocks/http';
import { getVisibleText } from './visibilityHelpers';

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



import FriendsScreen from '@/app/(online)/friends';


async function mount() {
  route('GET', '/api/friends', {
    body: [
      { id: 'f1', username: 'Besi', lastSeen: null },
      { id: 'f2', username: 'Ana', lastSeen: '2026-08-20T10:00:00.000Z' },
    ],
  });
  route('GET', '/api/friends/sent', { body: [] });
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(<FriendsScreen />, { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
  await view.socket().deliver('friend:online_list', { onlineIds: ['f1'] });
  await queriesSettled();
  return view;
}

describe('a friend row carries presence by text, not only by the avatar dot', () => {
  it('shows the online friend’s status text, actually visible', async () => {
    const r = await mount();
    getVisibleText(screen, /online/i);
    await r.unmount();
  });

  it('shows the offline friend’s last-seen text, actually visible', async () => {
    const r = await mount();
    getVisibleText(screen, /seen/i);
    await r.unmount();
  });
});
