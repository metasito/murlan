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

const STORAGE_KEY = 'murlan_user';
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
