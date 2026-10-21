// tests/native/authFailureAfterSwitch.test.tsx — a 401 belongs to the account
// whose socket minted it. A signed-out account's socket can still be mid-mint
// when the next one signs in, and its dead session must not sign that one out.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

import { useAuth } from '@/context/AuthContext';
import { renderApp } from './harness/renderApp';
import { route } from './mocks/http';
import { fakeSockets } from './mocks/socketIo';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() },
}));

function Account() {
  return <Text testID="account">{useAuth().user?.username ?? 'signed out'}</Text>;
}

beforeEach(() => {
  route('POST', '/api/auth/socket-ticket', { body: { ticket: 't' } });
  mockReplace.mockClear();
});

describe('a 401 after the account changed', () => {
  it('on the previous account’s socket signs nobody out', async () => {
    const view = await renderApp(<Account />, { user: { id: 'u1', username: 'Ana' } });
    const [ana] = fakeSockets();

    await view.signIn({ id: 'u2', username: 'Ben' });
    const [, ben] = fakeSockets();
    const account = () => view.getByTestId('account').props.children;
    await act(async () => void (await Promise.all([ana.credentials, ben.credentials])));
    route('POST', '/api/auth/socket-ticket', { status: 401 });
    await act(async () => void (await ana.handshake()));

    expect(account()).toBe('Ben');
    expect(ben.disconnect).not.toHaveBeenCalled();

    // The control: the signed-in account's own 401 still signs it out.
    await act(async () => void (await ben.handshake()));
    expect(account()).toBe('signed out');
    await view.unmount();
  });
});
