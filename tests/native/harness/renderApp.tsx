import { afterEach, expect } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { useEffect } from 'react';
import { Dimensions } from 'react-native';
import { AppProviders } from '@/context/AppProviders';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { queryClient } from '@/lib/query-client';
import { AUTH_USER_KEY } from '@/lib/storageKeys';
import { route } from '../mocks/http';
import { fakeSockets, type FakeSocket } from '../mocks/socketIo';

const auth = { settled: false };

// Runs after the testing library's cleanup unmounts: a query left in the app's client holds a gc timer that keeps jest from exiting.
afterEach(() => queryClient.clear());

function AuthSettled() {
  const { loading } = useAuth();
  useEffect(() => {
    auth.settled = !loading;
  });
  return null;
}

/**
 * `ui` under the app's own provider stack, once the account has booted: `user` is the session the
 * server confirms (`null`, the default, answers 401), cached as a returning player's is.
 */
export async function renderApp(ui: React.ReactElement, { user = null }: { user?: AuthUser | null } = {}) {
  auth.settled = false;
  route('GET', '/api/auth/me', user ? { body: user } : { status: 401 });
  if (user) await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  else await AsyncStorage.removeItem(AUTH_USER_KEY);
  const sockets = fakeSockets().length;
  const view = await render(
    <AppProviders>
      <AuthSettled />
      {ui}
    </AppProviders>
  );
  // SafeAreaProvider renders nothing until the native side reports the window's insets, as a device does.
  const { width, height } = Dimensions.get('window');
  await fireEvent(view.container.queryAll((n) => n.type === 'RNCSafeAreaProvider')[0], 'insetsChange', {
    nativeEvent: { insets: { top: 0, right: 0, bottom: 0, left: 0 }, frame: { x: 0, y: 0, width, height } },
  });
  await waitFor(() => expect(auth.settled).toBe(true));
  return {
    ...view,
    /** The socket the account opened in this render; a file's later render of the same account reuses it. */
    socket: (): FakeSocket => {
      const socket = fakeSockets()[sockets] ?? fakeSockets().at(-1);
      if (!socket) throw new Error('the app opened no socket');
      return socket;
    },
  };
}
