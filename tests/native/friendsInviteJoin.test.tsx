// tests/native/friendsInviteJoin.test.tsx — joining from the friends screen's
// invite row accepts it, which keeps the invite's seat hold: never declined.
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
const mockAccept = jest.fn();
jest.mock('@/context/SocketContext', () => ({
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({
    invites: [{ from: 'Besi', roomCode: 'ABC123' }],
    dismiss: mockDismiss,
    accept: mockAccept,
  }),
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
  it('accepts the invite without declining it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <FriendsScreen />
        </SafeAreaProvider>
      </QueryClientProvider>
    );

    await fireEvent.press(screen.getByLabelText(/join besi/i));

    expect(mockAccept).toHaveBeenCalledWith('ABC123');
    expect(mockDismiss).not.toHaveBeenCalled();
    await view.unmount();
  });
});
