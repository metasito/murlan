// tests/native/settingsDeleteAccount.test.tsx — once the server has deleted the
// account the session is gone, so a logout POST that then fails must not turn
// a deletion that happened into "delete failed".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { stubFetch } from './helpers/stubFetch';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockReplace = jest.fn();

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: new (jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query')).QueryClient(),
}));
jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/lobby',
}));

import { SettingsModal } from '@/components/SettingsModal';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { NotificationProvider, useBanner } from '@/context/NotificationContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { en as locale } from '@/locales/en';
import { AUTH_USER_KEY } from '@/lib/storageKeys';

const METRICS = {
  frame: { x: 0, y: 0, width: 568, height: 320 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

function Probe() {
  const { notification } = useBanner();
  const { user } = useAuth();
  return (
    <>
      <Text testID="banner">{notification?.title ?? 'none'}</Text>
      <Text testID="user">{user?.username ?? 'signed-out'}</Text>
    </>
  );
}

async function mountSignedIn() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthProvider>
        <NotificationProvider>
          <SettingsProvider>
            <Probe />
            <SettingsModal visible onClose={() => {}} />
          </SettingsProvider>
        </NotificationProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
  await waitFor(() => expect(screen.getByTestId('user').props.children).toBe('Ana'));
}

async function confirmDelete() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(locale['settings.deleteAccount']));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('confirm-accept', { includeHiddenElements: true }));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(SIGNED_IN));
  stubFetch(
    jest.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200, ok: true, json: async () => SIGNED_IN })
  );
  mockApiRequest.mockImplementation(async (method, url) => {
    if (method === 'DELETE' && url === '/api/users/me') return {};
    throw new Error('500: logout failed');
  });
});

describe('deleting the account', () => {
  it('forgets the session locally without asking the server to log out', async () => {
    await mountSignedIn();
    await confirmDelete();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth'));
    expect(mockApiRequest).not.toHaveBeenCalledWith('POST', '/api/auth/logout');
    expect(screen.getByTestId('banner').props.children).toBe('none');
    expect(screen.getByTestId('user').props.children).toBe('signed-out');
    expect(await AsyncStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('still reports a deletion the server refused', async () => {
    mockApiRequest.mockRejectedValue(new Error('500: nope'));
    await mountSignedIn();
    await confirmDelete();

    await waitFor(() =>
      expect(screen.getByTestId('banner').props.children).toBe(locale['settings.deleteFailedTitle'])
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('user').props.children).toBe('Ana');
  });
});
