// tests/native/authLogout.test.tsx — logout withdraws the push registration
// before it asks the server to end the session, because the endpoint needs the
// cookie. Everything after the POST is skipped when it throws, so the failure
// path is where that ordering has to be undone.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRegisterForPush = jest.fn<() => Promise<void>>();
const mockUnregisterForPush = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// Called through rather than handed over: the factory runs while AuthContext
// is being imported, before the consts above have initialised.
jest.mock('@/lib/pushRegistration', () => ({
  registerForPush: () => mockRegisterForPush(),
  unregisterForPush: () => mockUnregisterForPush(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const STORAGE_KEY = 'murlan_user';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };

const mockFetch = jest.fn<() => Promise<unknown>>();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

/** A player signed in on this device, with the boot check already settled. */
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
  mockRegisterForPush.mockResolvedValue(undefined);
  // Signed in on a device that took a registration.
  mockUnregisterForPush.mockResolvedValue(true);
  // `fetchMe` uses a raw fetch rather than apiRequest, so the boot check is
  // steered here and every apiRequest below belongs to logout itself.
  mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => SIGNED_IN });
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('a logout the server refuses', () => {
  beforeEach(() => {
    mockApiRequest.mockRejectedValue(new Error('500: logout failed'));
  });

  it('gives the device its push registration back', async () => {
    const { result, unmount } = await signedIn();

    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow('logout failed');
    });

    expect(mockUnregisterForPush).toHaveBeenCalledTimes(1);
    expect(mockRegisterForPush).toHaveBeenCalledTimes(1);
    unmount();
  });

  // `registerForPush` asks the OS for permission when it has not been asked,
  // so undoing a withdrawal that never happened is a dialog out of nowhere.
  it('leaves a device that was never registered alone', async () => {
    mockUnregisterForPush.mockResolvedValue(false);
    const { result, unmount } = await signedIn();

    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow('logout failed');
    });

    expect(mockRegisterForPush).not.toHaveBeenCalled();
    unmount();
  });

  it('leaves the player signed in, in state and in storage', async () => {
    const { result, unmount } = await signedIn();

    await act(async () => {
      await expect(result.current.logout()).rejects.toThrow('logout failed');
    });

    expect(result.current.user?.username).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(SIGNED_IN));
    unmount();
  });
});

describe('a logout the server accepts', () => {
  it('signs the player out, and leaves the device unregistered', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mockUnregisterForPush).toHaveBeenCalledTimes(1);
    expect(mockRegisterForPush).not.toHaveBeenCalled();
    unmount();
  });
});
