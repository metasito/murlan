// tests/native/authFailureAfterSwitch.test.tsx — a 401 belongs to the account
// whose socket minted it. A signed-out account's socket can still be mid-mint
// when the next one signs in, and its dead session must not sign that one out.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

const makeSocket = () => ({
  connected: false,
  active: true,
  on() {},
  off() {},
  emit() {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
});
const mockSockets = new Map<string, ReturnType<typeof makeSocket>>();
const mockAuthFailure = new Map<string, () => void>();

jest.mock('@/lib/socket', () => ({
  connectSocket: (userId: string, { onAuthFailure }: { onAuthFailure: () => void }) => {
    mockAuthFailure.set(userId, onAuthFailure);
    if (!mockSockets.has(userId)) mockSockets.set(userId, makeSocket());
    return mockSockets.get(userId);
  },
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? (mockSockets.get(userId) ?? null) : null),
  subscribeToSockets: () => () => {},
}));

const mockLogout = jest.fn(async () => {});
let mockUser: { id: string; username: string } | null = null;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, forgetSession: mockLogout }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() },
}));

const { SocketProvider } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } =
  require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

const client = new QueryClient();
const tree = () => (
  <QueryClientProvider client={client}>
    <NotificationProvider>
      <SocketProvider>{null}</SocketProvider>
    </NotificationProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  mockSockets.clear();
  mockAuthFailure.clear();
  mockLogout.mockClear();
  mockReplace.mockClear();
});

describe('a 401 after the account changed', () => {
  it('on the previous account’s socket signs nobody out', async () => {
    mockUser = { id: 'u1', username: 'Ana' };
    const view = await render(tree());
    const failAna = mockAuthFailure.get('u1')!;

    mockUser = { id: 'u2', username: 'Ben' };
    await view.rerender(tree());
    failAna();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockSockets.get('u2')!.disconnect).not.toHaveBeenCalled();

    // The control: the signed-in account's own 401 still signs it out.
    mockAuthFailure.get('u2')!();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
