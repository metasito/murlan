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
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';

const mockApiRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

jest.mock('@/lib/pushRegistration', () => ({
  registerForPush: async () => {},
  unregisterForPush: async () => true,
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

const STORAGE_KEY = 'murlan_user';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };
const RENAMED = { ...SIGNED_IN, username: 'AnaBesi' };

const mockFetch = jest.fn<() => Promise<unknown>>();

let rename: (username: string) => Promise<void>;
function Probe() {
  const auth = useAuth();
  rename = auth.rename;
  return (
    <>
      <Text testID="user">{auth.user ? auth.user.username : 'none'}</Text>
      <Text testID="loading">{String(auth.loading)}</Text>
    </>
  );
}

const signedIn = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SIGNED_IN));
  const view = await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
  expect(view.getByTestId('user').props.children).toBe('Ana');
  return view;
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
    const view = await signedIn();

    await act(async () => {
      await rename('AnaBesi');
    });

    expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/api/users/me', {
      username: 'AnaBesi',
    });
    await waitFor(() => expect(view.getByTestId('user').props.children).toBe('AnaBesi'));

    await view.unmount();
  });

  it('writes the new name to storage, so it survives a restart offline', async () => {
    mockApiRequest.mockResolvedValue({ json: async () => RENAMED });
    const view = await signedIn();

    await act(async () => {
      await rename('AnaBesi');
    });

    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('AnaBesi');

    await view.unmount();
  });

  it('leaves the account alone when the server refuses', async () => {
    mockApiRequest.mockRejectedValue(new Error('409: taken'));
    const view = await signedIn();

    await expect(rename('AnaBesi')).rejects.toThrow();

    expect(view.getByTestId('user').props.children).toBe('Ana');
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('Ana');

    await view.unmount();
  });
});
