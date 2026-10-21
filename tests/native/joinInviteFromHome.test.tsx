// tests/native/joinInviteFromHome.test.tsx — tapping Join on an invite seats
// the player, without asking again.
//
// The invite lives in `SocketContext`, above the whole app; `joinRoom` lives in
// `OnlineGameContext`, mounted inside the `(online)` group alone. So the tap
// records which room was asked for and the group performs it. What this pins is
// the half that silently stops working: that the group's router acts on an
// accepted invite, and that the hub does NOT re-open the join modal to ask for a
// code the player has already chosen (#398).
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';

// `mock`-prefixed because jest hoists these factories above every other
// statement in the file, and only that prefix is allowed out of scope.
const mockJoinRoom = jest.fn(async (_code: string) => ({ ok: true }));
const mockClearAccepted = jest.fn();
const mockState = {
  invites: {} as Record<string, unknown>,
  connected: true,
  room: null as { roomId: string } | null,
};

jest.mock('@/context/onlineGameHooks', () => ({
  useServerError: () => null,
  useOnlineRoom: () => ({
    createRoom: jest.fn(),
    joinRoom: mockJoinRoom,
    spectateRoom: jest.fn(),
    room: mockState.room,
    hasGame: false,
    isSpectator: false,
  }),
  useOnlineTable: () => ({ gameState: null }),
  useOnlineConnection: () => ({
    connected: mockState.connected,
    error: null,
    clearError: jest.fn(),
  }),
}));

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  useInvites: () => mockState.invites,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useSegments: () => ['(online)'],
}));

import OnlineLobbyScreen from '@/app/(online)/index';
import { useOnlineRouting } from '@/context/useOnlineRouting';

const Router = () => {
  useOnlineRouting();
  return null;
};


const mount = async () => {
  await setWindow({ width: 390, height: 844 });
  return renderApp(
    <>
      <Router />
      <OnlineLobbyScreen />
    </>,
    { user: { id: 'u1', username: 'me' } }
  );
};

const base = {
  prompt: null,
  clearPrompt: jest.fn(),
  invites: [],
  dismiss: jest.fn(),
  accepted: null,
  accept: jest.fn(),
  clearAccepted: mockClearAccepted,
};

beforeEach(() => {
  mockJoinRoom.mockClear();
  mockClearAccepted.mockClear();
  mockState.connected = true;
  mockState.room = null;
  mockState.invites = { ...base };
});

describe('an invite the player has already accepted', () => {
  it('joins that room without asking again', async () => {
    mockState.invites = { ...base, accepted: 'ABC123' };
    const r = await mount();

    expect(mockJoinRoom).toHaveBeenCalledWith('ABC123');
    // The owner's requirement in as many words: no room-code screen on this
    // path. The modal's own title is the thing that must not be on screen.
    expect(screen.queryByText('Join a room')).toBeNull();

    await r.unmount();
  });

  it('consumes it once the join is answered, so a re-render cannot join twice', async () => {
    mockState.invites = { ...base, accepted: 'ABC123' };
    const r = await mount();
    await act(async () => {});

    expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    expect(mockClearAccepted).toHaveBeenCalledTimes(1);
    expect(mockClearAccepted).toHaveBeenCalledWith('ABC123');

    await r.unmount();
  });

  it('waits for the socket rather than emitting into a closed one', async () => {
    // `joinRoom` is `socket?.emit`, which is a silent no-op before the socket
    // connects — the player would sit on an unchanged lobby forever.
    mockState.connected = false;
    mockState.invites = { ...base, accepted: 'ABC123' };
    const r = await mount();

    expect(mockJoinRoom).not.toHaveBeenCalled();
    expect(mockClearAccepted).not.toHaveBeenCalled();

    await r.unmount();
  });

  it('says it is joining, so the wait is not a dead screen', async () => {
    mockState.connected = false;
    mockState.invites = { ...base, accepted: 'ABC123' };
    const r = await mount();

    expect(screen.getByText('Joining the table…')).toBeTruthy();

    await r.unmount();
  });

  it('stops saying so once the room arrives', async () => {
    // The room is pushed *on top of* this screen rather than replacing it, so
    // this instance survives the join and is what back returns to.
    mockState.room = { roomId: 'r1' };
    mockState.invites = { ...base, accepted: 'ABC123' };
    const r = await mount();

    expect(screen.queryByText('Joining the table…')).toBeNull();

    await r.unmount();
  });
});

describe('an invite that merely arrived', () => {
  it('still asks, because nobody has answered it', async () => {
    mockState.invites = { ...base, prompt: { from: 'ana', roomCode: 'ZZZ999' } };
    const r = await mount();

    // An invite turning up must never move anyone: it prefills and asks.
    expect(mockJoinRoom).not.toHaveBeenCalled();
    expect(screen.getByText('Join a room')).toBeTruthy();

    await r.unmount();
  });
});

describe('an ordinary visit to the hub', () => {
  it('joins nothing and asks nothing', async () => {
    const r = await mount();

    expect(mockJoinRoom).not.toHaveBeenCalled();
    expect(screen.queryByText('Join a room')).toBeNull();
    expect(screen.queryByText('Joining the table…')).toBeNull();

    await r.unmount();
  });
});
