// tests/native/friendsActionFailure.test.tsx — a friend action the server
// refused puts the row back and says so; a pending list that failed to load
// says that instead of "nothing pending".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

jest.mock('@/context/SocketContext', () => ({
  useSocket: () => ({ socket: null, onlineIds: new Set(), gameInvites: [], dismissGameInvite: jest.fn() }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
}));

const mockShowNotification = jest.fn();
jest.mock('@/context/NotificationContext', () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
  useBannerBottom: () => 0,
}));

jest.mock('@/lib/query-client', () => ({
  ...(jest.requireActual('@/lib/query-client') as object),
  apiRequest: () => Promise.reject(new Error('offline')),
}));

import FriendsScreen from '@/app/(online)/friends';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const SEED: Record<string, unknown[]> = {
  '/api/friends': [{ id: 'f1', username: 'Besi', lastSeen: null }],
  '/api/friends/requests': [{ id: 'r1', username: 'Dora', createdAt: '2026-09-01T10:00:00.000Z' }],
  '/api/friends/sent': [{ id: 's1', username: 'Gent', createdAt: '2026-09-01T10:00:00.000Z' }],
};

async function mount(failing: string[] = []) {
  const qc: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }): Promise<unknown> => {
          const key = String(queryKey[0]);
          if (failing.includes(key)) throw new Error('offline');
          return qc.getQueryData(queryKey) ?? SEED[key];
        },
      },
    },
  });
  for (const key of Object.keys(SEED)) if (!failing.includes(key)) qc.setQueryData([key], SEED[key]);
  return render(
    <QueryClientProvider client={qc}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <FriendsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

describe('a refused friend action is undone and reported', () => {
  beforeEach(() => {
    mockShowNotification.mockClear();
  });

  const cases: [string, RegExp, string][] = [
    ['accept', /accept dora/i, 'Dora'],
    ['decline', /decline dora/i, 'Dora'],
    ['cancel', /cancel your request to gent/i, 'Gent'],
  ];
  for (const [name, label, username] of cases) {
    it(`${name} puts the row back and shows the error`, async () => {
      const view = await mount();
      await fireEvent.press(screen.getByLabelText(label));
      expect(screen.getByText(username)).toBeTruthy();
      expect(mockShowNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_error' }));
      await view.unmount();
    });
  }

  it('remove puts the friend back and shows the error', async () => {
    const view = await mount();
    await fireEvent.press(screen.getByLabelText(/remove besi/i));
    await fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(screen.getByText('Besi')).toBeTruthy();
    expect(mockShowNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_error' }));
    await view.unmount();
  });
});

describe('the pending section tells a failed load from an empty one', () => {
  it('shows an error with retry, not "nothing pending"', async () => {
    const view = await mount(['/api/friends/requests']);
    expect(await screen.findByLabelText(/try loading your pending requests again/i)).toBeTruthy();
    expect(screen.queryByText(/nothing pending/i)).toBeNull();
    await view.unmount();
  });
});
