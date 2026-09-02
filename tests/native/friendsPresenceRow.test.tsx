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
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getVisibleText } from './visibilityHelpers';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/pushRegistration', () => ({
  registerForPush: async () => {},
  unregisterForPush: async () => true,
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({
    socket: null,
    onlineIds: new Set(['f1']),
    gameInvites: [],
    dismissGameInvite: jest.fn(),
  }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({
    showNotification: jest.fn(),
    dismissNotification: jest.fn(),
    notification: null,
    bannerBottom: 0,
    reportBannerBottom: jest.fn(),
  }),
  useBannerBottom: () => 0,
}));

import FriendsScreen from '@/app/(online)/friends';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function mount() {
  const qc = new QueryClient();
  qc.setQueryData(['/api/friends'], [
    { id: 'f1', username: 'Besi', lastSeen: null },
    { id: 'f2', username: 'Ana', lastSeen: '2026-08-20T10:00:00.000Z' },
  ]);
  qc.setQueryData(['/api/friends/requests'], []);
  qc.setQueryData(['/api/friends/sent'], []);
  return render(
    <QueryClientProvider client={qc}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <FriendsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
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
