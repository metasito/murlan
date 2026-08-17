// tests/native/authBoot.test.tsx — a network failure at boot is not a logout.
//
// The boot check used to funnel every failure through one catch that cleared
// the cached user and wiped AsyncStorage, so opening the app during a redeploy
// or in a tunnel signed the player out for the whole session with a perfectly
// valid session cookie. Only a 401 is an answer; everything else is silence.
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
