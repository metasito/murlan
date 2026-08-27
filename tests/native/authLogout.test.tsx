// tests/native/authLogout.test.tsx — logout gives up the push registration
// before it asks the server to end the session, because the unregister needs
// the cookie. That ordering is what makes the failure path matter: everything
// after the POST is skipped when it throws, so what it gave up first has to
// come back, or the device stops receiving invites while still signed in.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRegisterForPush = jest.fn<() => Promise<void>>();
const mockUnregisterForPush = jest.fn<() => Promise<void>>();

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

let logout: () => Promise<void>;
function Probe() {
  const auth = useAuth();
  logout = auth.logout;
  return (
    <>
      <Text testID="user">{auth.user ? auth.user.username : 'none'}</Text>
      <Text testID="loading">{String(auth.loading)}</Text>
    </>
  );
}

/** A player signed in on this device, with the boot check already settled. */
const signedIn = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SIGNED_IN));
  const view = await render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
  expect(view.getByTestId('user').props.children).toBe('Ana');
  return view;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockRegisterForPush.mockResolvedValue(undefined);
  mockUnregisterForPush.mockResolvedValue(undefined);
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
    const view = await signedIn();

    await act(async () => {
      await expect(logout()).rejects.toThrow('logout failed');
    });

    expect(mockUnregisterForPush).toHaveBeenCalledTimes(1);
    expect(mockRegisterForPush).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('leaves the player signed in, in state and in storage', async () => {
    const view = await signedIn();

    await act(async () => {
      await expect(logout()).rejects.toThrow('logout failed');
    });

    expect(view.getByTestId('user').props.children).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(SIGNED_IN));
    view.unmount();
  });
});

describe('a logout the server accepts', () => {
  it('signs the player out, and leaves the device unregistered', async () => {
    mockApiRequest.mockResolvedValue({ ok: true });
    const view = await signedIn();

    await act(async () => {
      await logout();
    });

    expect(view.getByTestId('user').props.children).toBe('none');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mockUnregisterForPush).toHaveBeenCalledTimes(1);
    expect(mockRegisterForPush).not.toHaveBeenCalled();
    view.unmount();
  });
});
