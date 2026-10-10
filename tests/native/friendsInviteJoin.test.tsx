// tests/native/friendsInviteJoin.test.tsx — joining from the friends screen's
// invite row keeps the invite's seat hold: the row is hidden, never declined.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
const mockHide = jest.fn();
jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({
    socket: null,
    onlineIds: new Set(),
    gameInvites: [{ from: 'Besi', roomCode: 'ABC123' }],
    dismissGameInvite: mockDismiss,
    hideGameInvite: mockHide,
  }),
}));

const mockJoinRoom = jest.fn();
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: mockJoinRoom, room: null }),
}));

jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: jest.fn() }),
  useBannerBottom: () => 0,
}));

import FriendsScreen from '@/app/(online)/friends';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe('joining from a friends-screen invite', () => {
  it('joins the room and hides the invite without declining it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <FriendsScreen />
        </SafeAreaProvider>
      </QueryClientProvider>
    );

    await fireEvent.press(screen.getByLabelText(/join besi/i));

    expect(mockJoinRoom).toHaveBeenCalledWith('ABC123');
    expect(mockHide).toHaveBeenCalledWith('ABC123');
    expect(mockDismiss).not.toHaveBeenCalled();
    await view.unmount();
  });
});
