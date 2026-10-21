// tests/native/serverErrorSurface.test.tsx — a server refusal belongs to the
// surface it answered, and is worded in the language on screen when it is read.
//
// The real provider and the real room screen: every online screen the router
// holds can be mounted at once, and what this pins is that one of them cannot
// consume what another is showing.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { room } from './harness/wire';
import { route } from './mocks/http';
import { bannerLog } from './harness/bannerLog';
import type { FakeSocket } from './mocks/socketIo';
import { Pressable, Text } from 'react-native';

const { shown, BannerLog } = bannerLog();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));

import { useOnlineRoom, useServerError } from '@/context/onlineGameHooks';
import { setLocale } from '@/lib/i18n';
import { en } from '@/locales/en';
import { sq } from '@/locales/sq';

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;


const ROOM = room({ roomId: 'r1', code: 'ABCDEF', hostUserId: 'u1' });

function LobbyProbe() {
  return <Text testID="lobby-error">{useServerError('lobby')?.text ?? ''}</Text>;
}
type Attempt = 'createRoom' | 'joinRoom' | 'spectateRoom' | 'quickmatch';
function Attempts() {
  const room = useOnlineRoom();
  const tries: Record<Attempt, () => void> = {
    createRoom: () => room.createRoom('free_for_all', 4),
    joinRoom: () => void room.joinRoom('ABCDEF'),
    spectateRoom: () => room.spectateRoom('ABCDEF'),
    quickmatch: () => room.quickmatch(4, 'free_for_all'),
  };
  return (
    <>
      {Object.entries(tries).map(([name, run]) => (
        <Pressable key={name} testID={name} onPress={run} />
      ))}
    </>
  );
}
const lobbyError = () => screen.getByTestId('lobby-error').props.children;

let socket: () => FakeSocket;

const mount = async (child?: React.ReactNode) => {
  route('GET', '/api/friends', { body: [] });
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(
    <>
      <BannerLog />
      <LobbyProbe />
      {child}
    </>,
    { user: { id: 'u1', username: 'Ana' }, online: true, connected: true }
  );
  socket = view.socket;
  return view;
};

beforeEach(() => {
  shown.length = 0;
});
afterEach(async () => {
  await act(() => setLocale('en'));
});

describe('a server refusal', () => {
  it("is the lobby's when no room answered it, and the room screen neither toasts nor clears it", async () => {
    const r = await mount(<RoomScreen />);
    await socket().deliver('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    await socket().deliver('room:state', ROOM);
    expect(shown).toEqual([]);
    expect(lobbyError()).toBe(en['server.ROOM_NOT_FOUND']);
    await r.unmount();
  });

  it("is the room's once a room is held, toasted there once and kept off the lobby", async () => {
    const r = await mount(<RoomScreen />);
    await socket().deliver('room:state', ROOM);
    await socket().deliver('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ message: en['server.ROOM_NOT_FOUND'] });
    expect(lobbyError()).toBe('');
    await r.unmount();
  });

  it('standing, is reworded when the language changes', async () => {
    const r = await mount();
    await socket().deliver('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    expect(lobbyError()).toBe(en['server.ROOM_NOT_FOUND']);
    await act(() => setLocale('sq'));
    expect(lobbyError()).toBe(sq['server.ROOM_NOT_FOUND']);
    await r.unmount();
  });

  it.each<Attempt>(['createRoom', 'joinRoom', 'spectateRoom', 'quickmatch'])('is retired by a new attempt: %s', async (attempt) => {
    const r = await mount(<Attempts />);
    await socket().deliver('room:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    expect(lobbyError()).toBe(en['server.ROOM_NOT_FOUND']);
    await fireEvent.press(screen.getByTestId(attempt));
    expect(lobbyError()).toBe('');
    await r.unmount();
  });
});
