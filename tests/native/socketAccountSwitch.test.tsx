// tests/native/socketAccountSwitch.test.tsx — an invite addressed to one
// account is gone the render another account takes the device.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, act, fireEvent } from '@testing-library/react-native';

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
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
  setSocketAuthFailureHandler: () => {},
}));

let mockUser: { id: string; username: string } | null = { id: 'u1', username: 'Ana' };
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, logout: async () => {} }),
}));

const { SocketProvider, useSocket } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

function Probe() {
  const { pendingInvite, acceptedInvite, acceptInvite } = useSocket();
  return (
    <>
      <Text testID="pending">{pendingInvite?.roomCode ?? 'none'}</Text>
      <Text testID="accepted">{acceptedInvite ?? 'none'}</Text>
      <Pressable testID="accept" onPress={() => acceptInvite('WXYZ')} />
    </>
  );
}

const tree = () => (
  <QueryClientProvider client={new QueryClient()}>
    <NotificationProvider>
      <SocketProvider>
        <Probe />
      </SocketProvider>
    </NotificationProvider>
  </QueryClientProvider>
);

describe('an account change', () => {
  it.each([
    ['signing out', null],
    ['signing in as someone else', { id: 'u2', username: 'Ben' }],
  ])('%s retires both invites', async (_name, next) => {
    mockUser = { id: 'u1', username: 'Ana' };
    mockSocket.listeners.clear();
    const view = await render(tree());

    await fireEvent.press(view.getByTestId('accept'));
    await act(async () => {
      mockSocket.listeners.get('friend:invite')?.({ from: 'Cleo', roomCode: 'ABCD' });
    });
    expect(view.getByTestId('pending').props.children).toBe('ABCD');
    expect(view.getByTestId('accepted').props.children).toBe('WXYZ');

    mockUser = next;
    await view.rerender(tree());

    expect(view.getByTestId('pending').props.children).toBe('none');
    expect(view.getByTestId('accepted').props.children).toBe('none');
    await view.unmount();
  });
});
