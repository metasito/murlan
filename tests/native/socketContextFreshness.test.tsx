// tests/native/socketContextFreshness.test.tsx — useSocketConnection() must
// reflect the connected-socket instance on any render once it exists, not
// only on a render that onlineIds/pendingInvite/gameInvites happens to
// trigger. A render forced by something else, before "connect"
// fires, is exactly the window a ref-backed memo goes stale in.
import { describe, it, expect, beforeEach } from '@jest/globals';
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent } from '@testing-library/react-native';

import { useSocketConnection } from '@/context/SocketContext';
import { renderApp } from './harness/renderApp';
import { lastSocket } from './mocks/socketIo';

let seen: { hasSocket: boolean }[] = [];

function Probe() {
  const socket = useSocketConnection();
  seen.push({ hasSocket: socket !== null });
  return <Text>probe</Text>;
}

function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <>
      <Pressable testID="tick" onPress={() => setTick((t) => t + 1)}>
        <Text>{tick}</Text>
      </Pressable>
      <Probe />
    </>
  );
}

describe('useSocketConnection() freshness', () => {
  beforeEach(() => {
    seen = [];
  });

  it('is non-null on a render triggered by something else, before "connect" fires', async () => {
    const view = await renderApp(<Harness />, { user: { id: 'u1', username: 'Ana' } });

    expect(lastSocket().listening('connect')).toBe(1);

    await fireEvent.press(view.getByTestId('tick'));

    const last = seen[seen.length - 1];
    expect(last.hasSocket).toBe(true);

    await view.unmount();
  });
});
