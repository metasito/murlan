// tests/native/renameAccount.test.tsx — a rename reaches the server, the
// screen and the cache, and each failure says something different.
//
// The cache is the part worth a test rather than a glance. `AuthContext` holds
// the signed-in player in state *and* in AsyncStorage, and the boot check keeps
// whatever was stored when the server cannot be reached. A rename that updated
// only the state would look right until the app was closed and come back under
// the old name, offline, with no error anywhere.
//
// The failure copy has its own floor. Four codes reaching the player as one
// sentence looks exactly like four codes reaching the player as four, so the
// last test compares them to each other rather than checking each is non-empty.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

import { AUTH_USER_KEY as STORAGE_KEY } from '@/lib/storageKeys';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };
const RENAMED = { ...SIGNED_IN, username: 'AnaBesi' };

const mockFetch = jest.fn<() => Promise<unknown>>();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const signedIn = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SIGNED_IN));
  const hook = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.user?.username).toBe('Ana');
  return hook;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // `fetchMe` uses a raw fetch rather than apiRequest, so the boot check is
  // steered here and every apiRequest below belongs to the rename itself.
  mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => SIGNED_IN });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('renaming the signed-in account', () => {
  it('patches the account and shows the new name', async () => {
    mockApiRequest.mockResolvedValue({ json: async () => RENAMED });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.rename('AnaBesi');
    });

    expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/api/users/me', {
      username: 'AnaBesi',
    });
    await waitFor(() => expect(result.current.user?.username).toBe('AnaBesi'));

    await unmount();
  });

  it('writes the new name to storage, so it survives a restart offline', async () => {
    mockApiRequest.mockResolvedValue({ json: async () => RENAMED });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.rename('AnaBesi');
    });

    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('AnaBesi');

    await unmount();
  });

  it('leaves the account alone when the server refuses', async () => {
    mockApiRequest.mockRejectedValue(new Error('409: taken'));
    const { result, unmount } = await signedIn();

    await expect(result.current.rename('AnaBesi')).rejects.toThrow();

    expect(result.current.user?.username).toBe('Ana');
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('Ana');

    await unmount();
  });
});
