// tests/native/socketAccountSwitch.test.tsx — an invite addressed to one
// account is gone the render another account takes the device.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';

import { useInvites } from '@/context/SocketContext';
import type { AuthUser } from '@/context/AuthContext';
import { renderApp } from './harness/renderApp';

function Probe() {
  const { prompt: pendingInvite, accepted: acceptedInvite, accept: acceptInvite } = useInvites();
  return (
    <>
      <Text testID="pending">{pendingInvite?.roomCode ?? 'none'}</Text>
      <Text testID="accepted">{acceptedInvite ?? 'none'}</Text>
      <Pressable testID="accept" onPress={() => acceptInvite('WXYZ')} />
    </>
  );
}


describe('an account change', () => {
  it.each([
    ['signing out', null],
    ['signing in as someone else', { id: 'u2', username: 'Ben' }],
  ])('%s retires both invites', async (_name, next: AuthUser | null) => {
    const view = await renderApp(<Probe />, { user: { id: 'u1', username: 'Ana' } });

    await fireEvent.press(view.getByTestId('accept'));
    await act(async () => {
      view.socket().serverEmit('friend:invite', { from: 'Cleo', roomCode: 'ABCD' });
    });
    expect(view.getByTestId('pending').props.children).toBe('ABCD');
    expect(view.getByTestId('accepted').props.children).toBe('WXYZ');

    await (next ? view.signIn(next) : view.signOut());

    expect(view.getByTestId('pending').props.children).toBe('none');
    expect(view.getByTestId('accepted').props.children).toBe('none');
    await view.unmount();
  });
});
