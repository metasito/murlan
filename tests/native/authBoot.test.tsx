// tests/native/authBoot.test.tsx — a network failure at boot is not a logout.
//
// Only a 401 answers the question. A network throw or a 5xx — a redeploy
// window, a tunnel — is silence, and must leave the cached user and
// AsyncStorage untouched rather than signing the player out of a live session.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider, useAuth } from '@/context/AuthContext';

jest.mock('@/lib/query-client', () => ({
  getApiUrl: () => 'http://localhost',
  apiRequest: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));

import { AUTH_USER_KEY as STORAGE_KEY } from '@/lib/storageKeys';
const CACHED = { id: 'u1', username: 'Ana' };

const mockFetch = jest.fn<() => Promise<unknown>>();

function Probe() {
  const { user, loading } = useAuth();
  return (
    <>
      <Text testID="user">{user ? user.username : 'none'}</Text>
      <Text testID="loading">{String(loading)}</Text>
    </>
  );
}

const mount = () => render(<AuthProvider><Probe /></AuthProvider>);

const bootWithCachedUser = async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED));
  const view = await mount();
  await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
  return view;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockFetch.mockReset();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe('the boot check', () => {
  it('keeps the cached user when the request never lands', async () => {
    mockFetch.mockRejectedValue(new Error('Network request failed'));

    const view = await bootWithCachedUser();

    expect(view.getByTestId('user').props.children).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(CACHED));

    await view.unmount();
  });

  it('keeps the cached user on a 503', async () => {
    mockFetch.mockResolvedValue({ status: 503, ok: false });

    const view = await bootWithCachedUser();

    expect(view.getByTestId('user').props.children).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(CACHED));

    await view.unmount();
  });

  it('clears the cached user on a 401', async () => {
    mockFetch.mockResolvedValue({ status: 401, ok: false });

    const view = await bootWithCachedUser();

    await waitFor(() => expect(view.getByTestId('user').props.children).toBe('none'));
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();

    await view.unmount();
  });
});

describe('a storage failure', () => {
  const diskFull = () => Promise.reject(new Error('disk full'));

  it('still ends the boot when the cache cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(diskFull);
    mockFetch.mockResolvedValue({ status: 503, ok: false });

    const view = await mount();

    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
    await view.unmount();
  });

  it('still ends the boot when the answer cannot be cached', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(diskFull);
    mockFetch.mockResolvedValue({ status: 200, ok: true, json: async () => CACHED });

    const view = await mount();

    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
    expect(view.getByTestId('user').props.children).toBe('Ana');
    await view.unmount();
  });

  it('does not fail a sign-in, rename or email change that already landed', async () => {
    mockFetch.mockResolvedValue({ status: 401, ok: false });
    const { apiRequest } = require('@/lib/query-client') as { apiRequest: jest.Mock };
    apiRequest.mockImplementation(async () => ({ json: async () => CACHED }));
    const auth: { current?: ReturnType<typeof useAuth> } = {};
    function Capture() {
      const value = useAuth();
      React.useEffect(() => {
        auth.current = value;
      });
      return null;
    }
    const view = await render(<AuthProvider><Capture /></AuthProvider>);
    await waitFor(() => expect(auth.current?.loading).toBe(false));

    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(diskFull);
    await expect(auth.current!.login('Ana', 'pw')).resolves.toBeUndefined();
    await expect(auth.current!.rename('Ana')).resolves.toBeUndefined();
    await expect(auth.current!.addEmail('a@b.c')).resolves.toBeUndefined();
    jest.restoreAllMocks();
    await view.unmount();
  });
});
