// tests/native/authFailureAfterSwitch.test.tsx — a 401 belongs to the account
// whose socket minted it. A signed-out account's socket can still be mid-mint
// when the next one signs in, and its dead session must not sign that one out.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import { route } from './mocks/http';
import { fakeSockets } from './mocks/socketIo';

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
  route('POST', '/api/auth/socket-ticket', { status: 401 });
  mockLogout.mockClear();
  mockReplace.mockClear();
});

describe('a 401 after the account changed', () => {
  it('on the previous account’s socket signs nobody out', async () => {
    mockUser = { id: 'u1', username: 'Ana' };
    const view = await render(tree());
    const [ana] = fakeSockets();

    mockUser = { id: 'u2', username: 'Ben' };
    await view.rerender(tree());
    const [, ben] = fakeSockets();
    await act(async () => void (await ana.handshake()));

    expect(mockLogout).not.toHaveBeenCalled();
    expect(ben.disconnect).not.toHaveBeenCalled();

    // The control: the signed-in account's own 401 still signs it out.
    await act(async () => void (await ben.handshake()));
    expect(mockLogout).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
