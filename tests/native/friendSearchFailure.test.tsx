// tests/native/friendSearchFailure.test.tsx — a search that never reached the
// server says so; only the server's 404 says the user does not exist.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/lib/apiError';
import { en as locale } from '@/locales/en';

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
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({ invites: [], dismiss: jest.fn(), accept: jest.fn() }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
  useOnlineConnection: () => ({ error: null }),
  useServerError: () => null,
}));

jest.mock('@/context/NotificationContext', () =>
  (require('./helpers/notificationMock') as typeof import('./helpers/notificationMock')).notificationContextMock(() => jest.fn())
);

const mockApiRequest = jest.fn<(method: string, url: string) => Promise<unknown>>();
jest.mock('@/lib/query-client', () => ({
  ...(jest.requireActual('@/lib/query-client') as object),
  apiRequest: (method: string, url: string) => mockApiRequest(method, url),
}));

import FriendsScreen from '@/app/(online)/friends';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function searchFailingWith(error: unknown) {
  mockApiRequest.mockRejectedValue(error);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  const view = await render(
    <QueryClientProvider client={qc}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <FriendsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
  await fireEvent.changeText(screen.getByPlaceholderText(locale['friends.usernamePlaceholder']), 'ghost');
  await fireEvent.press(screen.getByRole('button', { name: locale['friends.searchA11yLabel'] }));
  return view;
}

describe('friend search failure', () => {
  it('a dropped connection says the search failed, not that the user is missing', async () => {
    const view = await searchFailingWith(new Error('offline'));
    expect(await screen.findByText(locale['friends.searchFailed'])).toBeTruthy();
    expect(screen.queryByText(locale['friends.userNotFound'])).toBeNull();
    await view.unmount();
  });

  it("the server's 404 says the user was not found", async () => {
    const view = await searchFailingWith(new ApiError(404, null, 'not found'));
    expect(await screen.findByText(locale['friends.userNotFound'])).toBeTruthy();
    expect(screen.queryByText(locale['friends.searchFailed'])).toBeNull();
    await view.unmount();
  });
});
