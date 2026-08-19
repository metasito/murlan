// tests/native/socketContextFreshness.test.tsx — useSocket().socket must
// reflect the connected-socket instance on any render once it exists, not
// only on a render that connected/onlineIds/pendingInvite/gameInvites
// happens to trigger. A render forced by something else, before "connect"
// fires, is exactly the window a ref-backed memo goes stale in.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent } from '@testing-library/react-native';

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
  setSocketAuthFailureHandler: () => {},
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, logout: async () => {} }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SocketProvider, useSocket } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

let seen: Array<{ hasSocket: boolean; connected: boolean }> = [];

function Probe() {
  const { socket, connected } = useSocket();
  seen.push({ hasSocket: socket !== null, connected });
  return <Text>probe</Text>;
}

function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <NotificationProvider>
        <SocketProvider>
          <Pressable testID="tick" onPress={() => setTick((t) => t + 1)}>
            <Text>{tick}</Text>
          </Pressable>
          <Probe />
        </SocketProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

describe('useSocket().socket freshness', () => {
  beforeEach(() => {
    mockSocket.connected = false;
    mockSocket.listeners.clear();
    seen = [];
  });

  it('is non-null on a render triggered by something else, before "connect" fires', async () => {
    const view = await render(<Harness />);

    expect(mockSocket.listeners.has('connect')).toBe(true);

    await fireEvent.press(view.getByTestId('tick'));

    const last = seen[seen.length - 1];
    expect(last.connected).toBe(false);
    expect(last.hasSocket).toBe(true);

    await view.unmount();
  });
});
