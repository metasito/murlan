// tests/native/socketContextFreshness.test.tsx — useSocketConnection() must
// reflect the connected-socket instance on any render once it exists, not
// only on a render that onlineIds/pendingInvite/gameInvites happens to
// trigger. A render forced by something else, before "connect"
// fires, is exactly the window a ref-backed memo goes stale in.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent } from '@testing-library/react-native';

import { lastSocket } from './mocks/socketIo';

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'Ana' }, forgetSession: async () => {} }),
}));

const { SocketProvider, useSocketConnection } = require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } = require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

let seen: { hasSocket: boolean }[] = [];

function Probe() {
  const socket = useSocketConnection();
  seen.push({ hasSocket: socket !== null });
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

describe('useSocketConnection() freshness', () => {
  beforeEach(() => {
    seen = [];
  });

  it('is non-null on a render triggered by something else, before "connect" fires', async () => {
    const view = await render(<Harness />);

    expect(lastSocket().listening('connect')).toBe(1);

    await fireEvent.press(view.getByTestId('tick'));

    const last = seen[seen.length - 1];
    expect(last.hasSocket).toBe(true);

    await view.unmount();
  });
});
