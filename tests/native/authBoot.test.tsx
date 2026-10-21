// tests/native/authBoot.test.tsx — a network failure at boot is not a logout.
//
// Only a 401 answers the question. A network throw or a 5xx — a redeploy
// window, a tunnel — is silence, and must leave the cached user and
// AsyncStorage untouched rather than signing the player out of a live session.
import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth, type AuthUser } from '@/context/AuthContext';
import { renderApp } from './harness/renderApp';
import { route, unreachable, type HttpReply } from './mocks/http';

jest.mock('@/lib/errorReporting', () => ({
  ...jest.requireActual<object>('@/lib/errorReporting'),
  setReportingAccount: jest.fn(async () => {}),
}));
const reportingAccount = (require('@/lib/errorReporting') as { setReportingAccount: jest.Mock })
  .setReportingAccount;
/** The pending crash reports are posted only for a signed-in account. */
const flushes = () => reportingAccount.mock.calls.filter(([id]) => id !== null);

import { ACCOUNT_KEYS, ACTIVE_ROOM_KEY, AUTH_USER_KEY as STORAGE_KEY, WAITING_ROOM_KEY } from '@/lib/storageKeys';
const CACHED = { id: 'u1', username: 'Ana' };

function Probe() {
  const { user, loading } = useAuth();
  return (
    <>
      <Text testID="user">{user ? user.username : 'none'}</Text>
      <Text testID="user-json">{JSON.stringify(user)}</Text>
      <Text testID="loading">{String(loading)}</Text>
    </>
  );
}

type Me = HttpReply | typeof unreachable;
const mount = (me: Me, cached: AuthUser | null = null) => renderApp(<Probe />, { cached, me });
const meIs = (me: Me) => route('GET', '/api/auth/me', me);
const signedIn: Me = { body: CACHED };

const bootWithCachedUser = async (me: Me) => {
  const view = await mount(me, CACHED);
  await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
  return view;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  reportingAccount.mockClear();
});

describe('the boot check', () => {
  it('keeps the cached user when the request never lands', async () => {
    const view = await bootWithCachedUser(unreachable);

    expect(view.getByTestId('user').props.children).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(CACHED));

    await view.unmount();
  });

  it('keeps the cached user on a 503', async () => {
    const view = await bootWithCachedUser({ status: 503 });

    expect(view.getByTestId('user').props.children).toBe('Ana');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(CACHED));

    await view.unmount();
  });

  it('drops a cached field of the wrong type rather than trusting it', async () => {
    const view = await mount(unreachable, { ...CACHED, email: 7, emailVerified: 'yes', tutorialSeenAt: 0 } as never);
    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));

    expect(JSON.parse(view.getByTestId('user-json').props.children)).toEqual(CACHED);

    await view.unmount();
  });

  it('clears the cached user on a 401', async () => {
    const view = await bootWithCachedUser({ status: 401 });

    await waitFor(() => expect(view.getByTestId('user').props.children).toBe('none'));
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();

    await view.unmount();
  });
});

describe('every path that ends the session empties the account keys', () => {
  const seedAccount = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(CACHED));
    await AsyncStorage.setItem(ACTIVE_ROOM_KEY, 'room-1');
    await AsyncStorage.setItem(WAITING_ROOM_KEY, 'ABCD');
  };
  const leftOver = async () =>
    (await AsyncStorage.multiGet(ACCOUNT_KEYS)).filter(([, value]) => value !== null);

  const capture = async (me: Me) => {
    const auth: { current?: ReturnType<typeof useAuth> } = {};
    function Capture() {
      const value = useAuth();
      React.useEffect(() => {
        auth.current = value;
      });
      return null;
    }
    const view = await renderApp(<Capture />, { cached: CACHED, me });
    await waitFor(() => expect(auth.current?.loading).toBe(false));
    return { auth, view };
  };

  it('a 401 on boot', async () => {
    await seedAccount();

    const { auth, view } = await capture({ status: 401 });

    await waitFor(() => expect(auth.current?.user).toBeNull());
    await waitFor(async () => expect(await leftOver()).toEqual([]));
    await view.unmount();
  });

  it('a 401 on refreshUser', async () => {
    const { auth, view } = await capture(signedIn);
    await waitFor(() => expect(auth.current?.user?.id).toBe('u1'));
    await seedAccount();

    meIs({ status: 401 });
    await act(async () => auth.current!.refreshUser());

    expect(auth.current?.user).toBeNull();
    expect(await leftOver()).toEqual([]);
    await view.unmount();
  });

  // What SocketContext calls on a ticket 401 (tests/native/authFailureAfterSwitch.test.tsx).
  it('forgetSession, the socket 401', async () => {
    const { auth, view } = await capture(signedIn);
    await waitFor(() => expect(auth.current?.user?.id).toBe('u1'));
    await seedAccount();

    await act(async () => auth.current!.forgetSession());

    expect(auth.current?.user).toBeNull();
    expect(await leftOver()).toEqual([]);
    await view.unmount();
  });

  it('a 503 on refreshUser keeps everything', async () => {
    const { auth, view } = await capture(signedIn);
    await waitFor(() => expect(auth.current?.user?.id).toBe('u1'));
    await seedAccount();

    meIs({ status: 503 });
    await act(async () => auth.current!.refreshUser());

    expect(auth.current?.user?.id).toBe('u1');
    expect((await leftOver()).length).toBe(ACCOUNT_KEYS.length);
    await view.unmount();
  });

  // The behaviour above covers today's paths; this is what stops the next one
  // clearing the user and leaving the handles behind.
  it('no path but forgetSession sets the user to null', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'context', 'AuthContext.tsx'), 'utf8');
    const nulls = source.split('setUser(null)').length - 1;
    expect(nulls).toBe(1);
    const forget = source.slice(source.indexOf('const forgetSession = useCallback'));
    expect(forget.slice(0, forget.indexOf('}, []);'))).toContain('setUser(null)');
    // fetchMe() answers null for a 401, so each answer has to be split off before
    // it reaches setUser, or setUser(answer) is a second way to sign out.
    const answers = [...source.matchAll(/const (\w+) = await fetchMe\(\);/g)];
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      const after = source.slice(answer.index! + answer[0].length);
      const handled = after.slice(0, after.indexOf('setUser('));
      expect({ answer: answer[1], handled: handled.includes(`${answer[1]} === null`) }).toEqual({
        answer: answer[1],
        handled: true,
      });
    }
  });

  it('a register that finds no session', async () => {
    const { auth, view } = await capture(signedIn);
    await waitFor(() => expect(auth.current?.user?.id).toBe('u1'));
    await seedAccount();
    route('POST', '/api/auth/register', { body: { ok: true } });

    meIs({ status: 401 });
    await act(async () => {
      await auth.current!.register('Ana', 'pw', 'a@b.c');
    });

    expect(auth.current?.user).toBeNull();
    expect(await leftOver()).toEqual([]);
    await view.unmount();
  });
});

describe('crash reports kept while signed out', () => {
  it('are sent once a user is signed in', async () => {
    const view = await mount(signedIn);
    await waitFor(() => expect(flushes()).toEqual([['u1']]));
    await view.unmount();
  });

  it('wait while nobody is', async () => {
    const view = await mount({ status: 401 });
    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
    expect(flushes()).toEqual([]);
    await view.unmount();
  });
});

describe('a storage failure', () => {
  const diskFull = () => Promise.reject(new Error('disk full'));
  /** Fails `method` for the cached account only, once; every other key reaches storage. */
  const failAccountCache = (method: 'getItem' | 'setItem') => {
    const mock = AsyncStorage[method] as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    const real = mock.getMockImplementation()!;
    restore = () => mock.mockImplementation(real);
    let failed = false;
    mock.mockImplementation((key, ...rest) => {
      if (key !== STORAGE_KEY || failed) return real(key, ...rest);
      failed = true;
      return diskFull();
    });
  };
  let restore = () => {};
  afterEach(() => {
    restore();
    restore = () => {};
  });

  it('still ends the boot when the cache cannot be read', async () => {
    failAccountCache('getItem');

    const view = await mount({ status: 503 });

    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
    await view.unmount();
  });

  it('still ends the boot when the answer cannot be cached', async () => {
    failAccountCache('setItem');

    const view = await mount(signedIn);

    await waitFor(() => expect(view.getByTestId('loading').props.children).toBe('false'));
    expect(view.getByTestId('user').props.children).toBe('Ana');
    await view.unmount();
  });

  it('does not fail a sign-in, rename or email change that already landed', async () => {
    for (const [method, path] of [['POST', '/api/auth/login'], ['PATCH', '/api/users/me'], ['POST', '/api/auth/add-email']]) {
      route(method, path, { body: CACHED });
    }
    const auth: { current?: ReturnType<typeof useAuth> } = {};
    function Capture() {
      const value = useAuth();
      React.useEffect(() => {
        auth.current = value;
      });
      return null;
    }
    const view = await renderApp(<Capture />);
    await waitFor(() => expect(auth.current?.loading).toBe(false));

    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(diskFull);
    await expect(auth.current!.login('Ana', 'pw')).resolves.toBeUndefined();
    await expect(auth.current!.rename('Ana')).resolves.toBeUndefined();
    await expect(auth.current!.addEmail('a@b.c')).resolves.toBeUndefined();
    jest.restoreAllMocks();
    await view.unmount();
  });
});
