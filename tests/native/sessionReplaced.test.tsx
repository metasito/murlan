// tests/native/sessionReplaced.test.tsx — what the client does when the server
// says the account moved.
//
// lib/socket.ts sets reconnectionAttempts: Infinity, so a socket the server
// closes is retried within the second. On SESSION_REPLACED that retry would
// evict whichever session just took the account, which would evict this one
// back, for as long as both are open. Stopping the reconnection is the whole
// point of the code, and a terminal state the player can act on is what
// replaces it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act, fireEvent } from '@testing-library/react-native';
import { en as locale } from '@/locales/en';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: true,
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
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
// eslint-disable-next-line @typescript-eslint/no-require-imports
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

const fireSocketError = async (payload: Record<string, unknown>) => {
  await act(async () => {
    mockSocket.listeners.get('socket:error')?.(payload);
  });
};

const REPLACED = {
  code: 'SESSION_REPLACED',
  message: 'Il tuo account è stato aperto altrove. Questa sessione è stata chiusa.',
};

describe('SESSION_REPLACED', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSocket.connected = true;
    mockSocket.active = true;
    mockSocket.listeners.clear();
    mockSocket.connect.mockClear();
    mockSocket.disconnect.mockClear();
    mockSocket.io.reconnection.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops reconnecting instead of trading the account back', async () => {
    const view = await mount();

    await fireSocketError(REPLACED);
    expect(mockSocket.io.reconnection).toHaveBeenCalledWith(false);
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockSocket.connect).not.toHaveBeenCalled();

    await act(async () => {
      view.unmount();
    });
  });

  it('states what happened, over whatever screen the player was on', async () => {
    const view = await mount();

    expect(view.queryByText(locale['sessionReplaced.title'])).toBeNull();

    await fireSocketError(REPLACED);
    expect(view.getByText(locale['sessionReplaced.title'])).toBeTruthy();
    expect(view.getByText(locale['server.SESSION_REPLACED'])).toBeTruthy();

    await act(async () => {
      view.unmount();
    });
  });

  it('takes the account back only when the player asks for it', async () => {
    const view = await mount();
    await fireSocketError(REPLACED);

    await act(async () => {
      fireEvent.press(view.getByText(locale['sessionReplaced.reconnect']));
    });

    expect(mockSocket.io.reconnection).toHaveBeenLastCalledWith(true);
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    expect(view.queryByText(locale['sessionReplaced.title'])).toBeNull();

    await act(async () => {
      view.unmount();
    });
  });

  it('leaves any other socket:error to the notification banner', async () => {
    const view = await mount();

    await fireSocketError({ code: 'RATE_LIMITED', message: 'Troppe richieste, rallenta.' });
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    expect(view.queryByText(locale['sessionReplaced.title'])).toBeNull();

    await act(async () => {
      view.unmount();
    });
  });
});
