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

import { queryClient as qc } from '@/lib/query-client';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
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

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  usePresence: () => ({ onlineIds: new Set(['f1']), refresh: () => {} }),
  useInvites: () => ({ invites: [], dismiss: jest.fn(), accept: jest.fn() }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
  useOnlineConnection: () => ({ clearError: jest.fn() }),
  useServerError: () => null,
}));


import FriendsScreen from '@/app/(online)/friends';


async function mount() {
  qc.setQueryData(['/api/friends'], [
    { id: 'f1', username: 'Besi', lastSeen: null },
    { id: 'f2', username: 'Ana', lastSeen: '2026-08-20T10:00:00.000Z' },
  ]);
  qc.setQueryData(['/api/friends/requests'], []);
  qc.setQueryData(['/api/friends/sent'], []);
  await setWindow({ width: 390, height: 844 });
  return renderApp(<FriendsScreen />, { user: { id: 'u1', username: 'Ana' } });
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
