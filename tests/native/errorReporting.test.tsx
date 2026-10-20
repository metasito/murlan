// tests/native/errorReporting.test.tsx — the crashes the error boundary cannot
// see. A React boundary catches render, lifecycle and commit errors; a rejected
// promise, a socket callback and a timer all throw straight past it, and before
// #165 none of them was ever reported.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));
jest.mock('@/lib/query-client', () => ({
  apiRequest: jest.fn(() => Promise.resolve({ ok: true })),
  getApiUrl: () => 'http://localhost',
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_CRASH_REPORTS_MAX,
  installGlobalErrorHandlers,
  reportError,
  reportSocketClose,
  setCurrentScreen,
  setReportingAccount,
  resetErrorReportingForTests,
} from '@/lib/errorReporting';

import { PENDING_CRASH_REPORTS_KEY } from '@/lib/storageKeys';

const apiRequest = (require('@/lib/query-client') as { apiRequest: jest.Mock }).apiRequest;

type Listener = (event: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const fakeWindow = {
  addEventListener(type: string, fn: Listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener(type: string, fn: Listener) {
    listeners.get(type)?.delete(fn);
  },
};

/** What the browser does when nothing handles a rejected promise. */
const emit = (type: string, event: unknown) => {
  const fns = listeners.get(type);
  expect(fns?.size ?? 0).toBeGreaterThan(0);
  for (const fn of fns!) fn(event);
};

const sent = () => apiRequest.mock.calls.map((c) => c[2] as Record<string, unknown>);

let teardown: () => void = () => {};

beforeEach(() => {
  listeners.clear();
  apiRequest.mockClear();
  resetErrorReportingForTests();
  (globalThis as { window?: unknown }).window = fakeWindow;
  teardown = installGlobalErrorHandlers();
});

afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe('an unhandled rejection reaches the endpoint', () => {
  it('reports it, with the screen and the app version', () => {
    setCurrentScreen('/game');
    emit('unhandledrejection', { reason: new Error('socket ack never came') });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, route] = apiRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(route).toBe('/api/client-errors');
    expect(sent()[0]).toMatchObject({
      message: 'socket ack never came',
      screen: '/game',
      appVersion: '9.9.9',
      platform: 'web',
    });
    expect(typeof sent()[0].stack).toBe('string');
  });

  it('reports a throw from a timer or event handler too', () => {
    setCurrentScreen('/lobby');
    emit('error', { error: new Error('setTimeout threw'), message: 'setTimeout threw' });

    expect(sent()[0]).toMatchObject({ message: 'setTimeout threw', screen: '/lobby' });
  });

  it('survives a rejection with no Error in it', () => {
    emit('unhandledrejection', { reason: 'a bare string' });
    expect(sent()[0]).toMatchObject({ message: 'a bare string' });
  });
});

describe('one throw makes one row', () => {
  it('does not report the same Error twice when both paths see it', () => {
    const error = new Error('caught by the global handler, then by the boundary');
    emit('unhandledrejection', { reason: error });
    reportError(error, 'at Hand\n at GameTable');

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  // The floor. Deduplicating everything would satisfy the assertion above
  // perfectly while reporting nothing at all, which is the defect this whole
  // issue is about.
  it('still reports a genuinely different error', () => {
    emit('unhandledrejection', { reason: new Error('first') });
    emit('unhandledrejection', { reason: new Error('second') });

    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(sent().map((s) => s.message)).toEqual(['first', 'second']);
  });
});

describe('the reporter cannot take the app down with it', () => {
  it('swallows a reporter that throws, rather than throwing from the handler', () => {
    apiRequest.mockImplementationOnce(() => {
      throw new Error('the outage that caused the crash also breaks reporting');
    });

    expect(() => emit('unhandledrejection', { reason: new Error('original') })).not.toThrow();
  });

  it('does not report its own failure, which is the infinite loop', () => {
    apiRequest.mockImplementationOnce(() => {
      // What a global handler would do if the throw escaped: report it.
      const inner = new Error('reporting failed');
      expect(reportError(inner)).toBe(false);
      throw inner;
    });

    emit('unhandledrejection', { reason: new Error('original') });
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});

describe('reportSocketClose', () => {
  it('sends the reason through the same endpoint, with the screen and app version', () => {
    setCurrentScreen('/game');
    reportSocketClose('transport error');

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, route] = apiRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(route).toBe('/api/client-errors');
    expect(sent()[0]).toMatchObject({
      message: 'socket disconnect: transport error',
      screen: '/game',
      appVersion: '9.9.9',
      platform: 'web',
    });
  });

  // The server's own disconnect handler already records socket.closed for
  // every one of these — this call exists only for the one reason the server
  // structurally cannot observe (#844).
  it('does not post for a reason the server already records itself', () => {
    reportSocketClose('io client disconnect');
    reportSocketClose('io server disconnect');
    reportSocketClose('transport close');
    reportSocketClose('ping timeout');

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('posts for parse error too — the other reason only the client ever sees', () => {
    reportSocketClose('parse error');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('never throws when the endpoint itself throws', () => {
    apiRequest.mockImplementationOnce(() => {
      throw new Error('the outage that dropped the socket also breaks reporting');
    });

    expect(() => reportSocketClose('transport error')).not.toThrow();
  });
});

describe('a report the server never took', () => {
  const refused = () => Promise.reject(new Error('401: sign in first'));
  const kept = async () =>
    JSON.parse((await AsyncStorage.getItem(PENDING_CRASH_REPORTS_KEY)) ?? '[]') as { message: string }[];
  const eventually = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50 && !(await check()); i++) await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(() => AsyncStorage.clear());

  it('is kept on the device and sent after the next sign-in', async () => {
    apiRequest.mockImplementationOnce(refused);
    reportError(new Error('signed-out crash'));
    await eventually(async () => (await kept()).length > 0);
    expect((await kept()).map((r) => r.message)).toEqual(['signed-out crash']);

    apiRequest.mockClear();
    await setReportingAccount('u1');

    expect(sent().map((r) => r.message)).toEqual(['signed-out crash']);
    expect(await kept()).toEqual([]);
  });

  it('keeps only the newest few', async () => {
    apiRequest.mockImplementation(refused);
    const count = PENDING_CRASH_REPORTS_MAX + 2;
    for (let i = 0; i < count; i++) reportError(new Error(`crash ${i}`));
    await eventually(async () => (await kept()).some((r) => r.message === `crash ${count - 1}`));
    expect((await kept()).map((r) => r.message)).toEqual(
      Array.from({ length: PENDING_CRASH_REPORTS_MAX }, (_, i) => `crash ${i + 2}`)
    );
    apiRequest.mockImplementation(() => Promise.resolve({ ok: true }));
  });

  it('overwrites a corrupt list rather than losing every later report', async () => {
    await AsyncStorage.setItem(PENDING_CRASH_REPORTS_KEY, '{not json');
    apiRequest.mockImplementationOnce(refused);
    reportError(new Error('after the corruption'));
    await eventually(async () => (await AsyncStorage.getItem(PENDING_CRASH_REPORTS_KEY)) !== '{not json');
    expect((await kept()).map((r) => r.message)).toEqual(['after the corruption']);
  });

  it('is posted only by the account it was queued under', async () => {
    await setReportingAccount('A');
    apiRequest.mockImplementationOnce(refused);
    reportError(new Error('crash of A'));
    await eventually(async () => (await kept()).length > 0);

    apiRequest.mockClear();
    await setReportingAccount('B');
    expect(sent()).toEqual([]);
    expect((await kept()).map((r) => r.message)).toEqual(['crash of A']);

    await setReportingAccount('A');
    expect(sent().map((r) => r.message)).toEqual(['crash of A']);
    expect(sent()[0]).not.toHaveProperty('account');
    expect(await kept()).toEqual([]);
  });

  // An earlier build queued without an owner: whose they were is unknown, so
  // they are dropped rather than posted under whoever signs in.
  it('drops a report from before owners were recorded', async () => {
    await AsyncStorage.setItem(
      PENDING_CRASH_REPORTS_KEY,
      JSON.stringify([{ message: 'legacy crash of A' }])
    );

    apiRequest.mockClear();
    await setReportingAccount('B');

    expect(sent()).toEqual([]);
    expect(await kept()).toEqual([]);
  });

  it('records a signed-out report as owned by nobody', async () => {
    await setReportingAccount(null);
    apiRequest.mockImplementationOnce(refused);
    reportError(new Error('signed out'));
    await eventually(async () => (await kept()).length > 0);
    expect(await kept()).toEqual([expect.objectContaining({ message: 'signed out', account: null })]);
  });

  it('queued while signed out, goes with whoever signs in next', async () => {
    await setReportingAccount(null);
    apiRequest.mockImplementationOnce(refused);
    reportError(new Error('nobody signed in'));
    await eventually(async () => (await kept()).length > 0);

    apiRequest.mockClear();
    await setReportingAccount('B');
    expect(sent().map((r) => r.message)).toEqual(['nobody signed in']);
  });
});

describe('teardown', () => {
  it('stops reporting once removed', () => {
    const registered = () => [...listeners.values()].reduce((n, fns) => n + fns.size, 0);
    expect(registered()).toBeGreaterThan(0);
    teardown();
    expect(registered()).toBe(0);
  });
});
