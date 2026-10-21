import { afterEach, expect } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React, { useEffect } from 'react';
import { Dimensions } from 'react-native';
import { AppProviders } from '@/context/AppProviders';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { queryClient } from '@/lib/query-client';
import { peekSocket } from '@/lib/socket';
import { AUTH_USER_KEY } from '@/lib/storageKeys';
import { route, type HttpRequest, type HttpReply } from '../mocks/http';
import type { FakeSocket } from '../mocks/socketIo';

const auth = { settled: false, value: null as ReturnType<typeof useAuth> | null };

// Runs after the testing library's cleanup unmounts: a query left in the app's client holds a gc timer that keeps jest from exiting.
afterEach(() => queryClient.clear());

function AuthSettled() {
  const value = useAuth();
  useEffect(() => {
    auth.value = value;
    auth.settled = !value.loading;
  });
  return null;
}

/**
 * Every query the screen asked for has its answer, and its readers have rendered it: query-core
 * hands a settled answer to its observers on a zero timeout, after `isFetching()` already reads 0.
 */
export const queriesSettled = async () => {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

type Boot = {
  /** The session the server confirms; `null`, the default, answers 401. */
  user?: AuthUser | null;
  /** What the device cached from its last session; `user` unless set. */
  cached?: AuthUser | null;
  /** The boot's `GET /api/auth/me` answer, when it is not `user`'s. */
  me?: HttpReply | ((request: HttpRequest) => HttpReply | Promise<HttpReply>);
  /** False returns while the boot check is still out, for a screen's restoring state. */
  booted?: boolean;
};

/** `ui` under the app's own provider stack, once the account has booted. */
export async function renderApp(ui: React.ReactElement, { user = null, cached = user, me, booted = true }: Boot = {}) {
  auth.settled = false;
  route('GET', '/api/auth/me', me ?? (user ? { body: user } : { status: 401 }));
  if (cached) await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(cached));
  else await AsyncStorage.removeItem(AUTH_USER_KEY);
  const app = (node: React.ReactElement) => (
    <AppProviders>
      <AuthSettled />
      {node}
    </AppProviders>
  );
  const view = await render(app(ui));
  // SafeAreaProvider renders nothing until the native side reports the window's insets, as a device does.
  const { width, height } = Dimensions.get('window');
  await fireEvent(view.container.queryAll((n) => n.type === 'RNCSafeAreaProvider')[0], 'insetsChange', {
    nativeEvent: { insets: { top: 0, right: 0, bottom: 0, left: 0 }, frame: { x: 0, y: 0, width, height } },
  });
  if (booted) await waitFor(() => expect(auth.settled).toBe(true));
  return {
    ...view,
    /** `next` in place of the screen, under the same providers. */
    rerender: (next: React.ReactElement) => view.rerender(app(next)),
    /** The signed-in account's socket, which a later render in the same file reuses. */
    socket: (): FakeSocket => {
      const socket = peekSocket(user?.id);
      if (!socket) throw new Error('the account has no socket');
      return socket as unknown as FakeSocket;
    },
    /** The player signing in as `next` through the login form's own call, which the server accepts. */
    signIn: async (next: AuthUser) => {
      route('POST', '/api/auth/login', { body: next });
      route('GET', '/api/auth/me', { body: next });
      await act(() => auth.value!.login(next.username, 'password'));
    },
    /** The session ending on this device, as every path that proves it gone ends it. */
    signOut: async () => {
      route('GET', '/api/auth/me', { status: 401 });
      await act(() => auth.value!.forgetSession());
    },
  };
}

/** `hook` rendered under the app, inside `wrap`, read back as `result.current`. */
export async function renderAppHook<T>(
  hook: () => T,
  { wrap = (node) => node, ...boot }: Boot & { wrap?: (node: React.ReactElement) => React.ReactElement } = {}
) {
  const result = {} as { current: T };
  function Capture() {
    result.current = hook();
    return null;
  }
  const view = await renderApp(wrap(<Capture />), boot);
  return { ...view, result };
}
