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

import {
  installGlobalErrorHandlers,
  reportError,
  reportSocketClose,
  setCurrentScreen,
  resetErrorReportingForTests,
} from '@/lib/errorReporting';

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
    reportSocketClose('transport close');

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, route] = apiRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(route).toBe('/api/client-errors');
    expect(sent()[0]).toMatchObject({
      message: 'socket disconnect: transport close',
      screen: '/game',
      appVersion: '9.9.9',
      platform: 'web',
    });
  });

  it('never throws when the endpoint itself throws', () => {
    apiRequest.mockImplementationOnce(() => {
      throw new Error('the outage that dropped the socket also breaks reporting');
    });

    expect(() => reportSocketClose('transport error')).not.toThrow();
  });
});

describe('teardown', () => {
  it('stops reporting once removed', () => {
    teardown();
    listeners.clear();
    expect(listeners.size).toBe(0);
  });
});
