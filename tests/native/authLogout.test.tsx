// tests/native/authLogout.test.tsx — logout itself retires everything the
// signed-in account left on this device, and a refused logout retires nothing.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/query-client';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockForgetPushRegistration = jest.fn<() => void>();

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  queryClient: new (jest.requireActual('@tanstack/react-query') as typeof import('@tanstack/react-query')).QueryClient(),
}));

// Called through rather than handed over: the factory runs while AuthContext
// is being imported, before the consts above have initialised.
jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => mockForgetPushRegistration(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

import {
  ACCOUNT_KEYS,
  ACTIVE_ROOM_KEY,
  AUTH_USER_KEY as STORAGE_KEY,
  WAITING_ROOM_KEY,
} from '@/lib/storageKeys';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

const mockFetch = jest.fn<() => Promise<unknown>>();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

/** A player signed in on this device, mid-game, with a friends list cached. */
const signedIn = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SIGNED_IN));
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'room-1');
  await AsyncStorage.setItem(WAITING_ROOM_KEY, 'ABCD');
  queryClient.setQueryData(['/api/friends'], [{ id: 'u2' }]);
  const hook = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.user?.username).toBe('Ana');
  return hook;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  queryClient.clear();
  // `fetchMe` uses a raw fetch rather than apiRequest, so the boot check is
  // steered here and every apiRequest below belongs to logout itself.
  mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => SIGNED_IN });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('a logout the server refuses', () => {
  beforeEach(() => {
    mockApiRequest.mockRejectedValue(new Error('500: logout failed'));
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
    unmount();
  });
});

describe('a logout the server accepts', () => {
  it('retires every account-scoped key and the push registration, and leaves the cache to SocketProvider', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.logout();
    });

    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/auth/logout');
    expect(result.current.user).toBeNull();
    for (const key of ACCOUNT_KEYS) expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(queryClient.getQueryData(['/api/friends'])).toEqual([{ id: 'u2' }]);
    expect(mockForgetPushRegistration).toHaveBeenCalledTimes(1);
    unmount();
  });
});
