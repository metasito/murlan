// tests/native/settingsDeleteAccount.test.tsx — once the server has deleted the
// account the session is gone, so a logout POST that then fails must not turn
// a deletion that happened into "delete failed".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';

import { renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

const mockReplace = jest.fn();
jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/lobby',
}));

import { SettingsModal } from '@/components/SettingsModal';
import { useAuth } from '@/context/AuthContext';
import { useBanner } from '@/context/NotificationContext';
import { en as locale } from '@/locales/en';
import { AUTH_USER_KEY } from '@/lib/storageKeys';
import { setWindow } from './harness/env';
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
  await setWindow({ width: 568, height: 320 });
  await renderApp(
    <>
      <Probe />
      <SettingsModal visible onClose={() => {}} />
    </>,
    { user: SIGNED_IN }
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
  route('DELETE', '/api/users/me', { body: {} });
  route('POST', '/api/auth/logout', { status: 500, body: 'logout failed' });
});

describe('deleting the account', () => {
  it('forgets the session locally without asking the server to log out', async () => {
    await mountSignedIn();
    await confirmDelete();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth'));
    expect(httpRequests().filter((r) => r.method === 'POST' && r.path === '/api/auth/logout')).toEqual([]);
    expect(screen.getByTestId('banner').props.children).toBe('none');
    expect(screen.getByTestId('user').props.children).toBe('signed-out');
    expect(await AsyncStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('still reports a deletion the server refused', async () => {
    route('DELETE', '/api/users/me', { status: 500, body: 'nope' });
    await mountSignedIn();
    await confirmDelete();

    await waitFor(() =>
      expect(screen.getByTestId('banner').props.children).toBe(locale['settings.deleteFailedTitle'])
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('user').props.children).toBe('Ana');
  });
});
