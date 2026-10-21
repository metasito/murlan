// tests/native/authLogout.test.tsx — logout itself retires everything the
// signed-in account left on this device, and a refused logout retires nothing.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

const mockForgetPushRegistration = jest.fn<() => void>();

// Called through rather than handed over: the factory runs while AuthContext
// is being imported, before the consts above have initialised.
jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => mockForgetPushRegistration(),
}));

import {
  ACCOUNT_KEYS,
  ACTIVE_ROOM_KEY,
  AUTH_USER_KEY as STORAGE_KEY,
  WAITING_ROOM_KEY,
} from '@/lib/storageKeys';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

const auth = {} as { current: ReturnType<typeof useAuth> };
function Capture() {
  const value = useAuth();
  useEffect(() => {
    auth.current = value;
  });
  return null;
}
const result = auth;

/** A player signed in on this device, mid-game, with a friends list cached. */
const signedIn = async () => {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'room-1');
  await AsyncStorage.setItem(WAITING_ROOM_KEY, 'ABCD');
  queryClient.setQueryData(['/api/friends'], [{ id: 'u2' }]);
  const view = await renderApp(<Capture />, { user: SIGNED_IN });
  await waitFor(() => expect(auth.current.loading).toBe(false));
  expect(auth.current.user?.username).toBe('Ana');
  return { result, unmount: view.unmount };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  queryClient.clear();
});

describe('a logout the server refuses', () => {
  beforeEach(() => {
    route('POST', '/api/auth/logout', { status: 500, body: 'logout failed' });
  });

  it('leaves the account signed in and every piece of its state in place', async () => {
    const { result, unmount } = await signedIn();

    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow('logout failed');
    });

    expect(result.current.user?.username).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(SIGNED_IN));
    expect(await AsyncStorage.getItem(ACTIVE_ROOM_KEY)).toBe('room-1');
    expect(queryClient.getQueryData(['/api/friends'])).toEqual([{ id: 'u2' }]);
    expect(mockForgetPushRegistration).not.toHaveBeenCalled();
    await unmount();
  });
});

describe('a logout the server accepts', () => {
  it('retires every account-scoped key and the push registration, and SocketProvider empties the cache', async () => {
    route('POST', '/api/auth/logout', { body: { ok: true } });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.logout();
    });

    expect(httpRequests().filter((r) => r.path === '/api/auth/logout').map((r) => r.method)).toEqual(['POST']);
    expect(result.current.user).toBeNull();
    for (const key of ACCOUNT_KEYS) expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(queryClient.getQueryData(['/api/friends'])).toBeUndefined();
    expect(mockForgetPushRegistration).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
