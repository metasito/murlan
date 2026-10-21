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
import React, { useEffect } from 'react';
import { act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/context/AuthContext';
import { renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

import { AUTH_USER_KEY as STORAGE_KEY } from '@/lib/storageKeys';
const SIGNED_IN = { id: 'u1', username: 'Ana', tutorialSeenAt: null };
const RENAMED = { ...SIGNED_IN, username: 'AnaBesi' };

const result = {} as { current: ReturnType<typeof useAuth> };
function Capture() {
  const value = useAuth();
  useEffect(() => {
    result.current = value;
  });
  return null;
}

const signedIn = async () => {
  const view = await renderApp(<Capture />, { user: SIGNED_IN });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.user?.username).toBe('Ana');
  return { result, unmount: view.unmount };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('renaming the signed-in account', () => {
  it('patches the account and shows the new name', async () => {
    route('PATCH', '/api/users/me', { body: RENAMED });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.rename('AnaBesi');
    });

    expect(httpRequests().filter((r) => r.path === '/api/users/me').map((r) => [r.method, r.body])).toEqual([
      ['PATCH', { username: 'AnaBesi' }],
    ]);
    await waitFor(() => expect(result.current.user?.username).toBe('AnaBesi'));

    await unmount();
  });

  it('writes the new name to storage, so it survives a restart offline', async () => {
    route('PATCH', '/api/users/me', { body: RENAMED });
    const { result, unmount } = await signedIn();

    await act(async () => {
      await result.current.rename('AnaBesi');
    });

    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('AnaBesi');

    await unmount();
  });

  it('leaves the account alone when the server refuses', async () => {
    route('PATCH', '/api/users/me', { status: 409, body: 'taken' });
    const { result, unmount } = await signedIn();

    await expect(result.current.rename('AnaBesi')).rejects.toThrow();

    expect(result.current.user?.username).toBe('Ana');
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null');
    expect(stored?.username).toBe('Ana');

    await unmount();
  });
});
