// tests/native/socketReconnect.test.tsx — who owns the retry after a
// connect_error.
//
// socket.io is configured with reconnection: true and infinite attempts
// (lib/socket.ts), so a transport failure is already being retried by the
// library — `socket.active` stays true. A handshake the server middleware
// rejects is different: the CONNECT_ERROR packet destroys the socket's
// subscriptions, `active` goes false, and nothing retries unless SocketContext
// does. Two loops on the same socket is the failure this pins against.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act } from '@testing-library/react-native';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: false,
  active: true,
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
  },
  off() {},
  emit() {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
};

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <SocketProvider>
          <Text>child</Text>
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );

const fireConnectError = async () => {
  await act(async () => {
    mockSocket.listeners.get('connect_error')?.(new Error('rejected'));
  });
};

// The first attempt's delay with Math.random pinned below (lib/reconnectDelay.ts),
// and what identifies this handler's timer among the renderer's and react-query's.
const FIRST_RETRY_MS = 246;

describe('connect_error', () => {
  let setTimeoutSpy: jest.Spied<typeof setTimeout>;

  beforeEach(() => {
    jest.useFakeTimers();
    setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    jest.spyOn(Math, 'random').mockReturnValue(0.123);
    mockSocket.connected = false;
    mockSocket.active = true;
    mockSocket.listeners.clear();
    mockSocket.connect.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const scheduledRetries = () =>
    setTimeoutSpy.mock.calls.filter((call) => call[1] === FIRST_RETRY_MS).length;

  it('schedules no retry while socket.io is still reconnecting', async () => {
    const view = await mount();
    mockSocket.active = true;

    await fireConnectError();
    expect(scheduledRetries()).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockSocket.connect).not.toHaveBeenCalled();

    await act(async () => {
      view.unmount();
    });
  });

  it('retries itself once socket.io has given up', async () => {
    const view = await mount();
    mockSocket.active = false;

    await fireConnectError();
    expect(scheduledRetries()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.unmount();
    });
  });
});
