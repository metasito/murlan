// tests/native/spectateFailed.test.tsx — which teardown event leaving a table
// sends after a spectate attempt the server refused.
//
// `spectateRoom` claims the spectator flag before the server has answered, and
// the flag is what makes `leaveRoom` send `room:unspectate` instead of
// `room:leave`. Left set by a refusal it releases nothing on the next table the
// player actually sits at: the seat keeps being dealt hands and auto-passed
// while their own screen shows the lobby.
import { describe, it, expect, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor } from '@testing-library/react-native';

import { seat, state } from '../support/game';
import { renderAppHook } from './harness/renderApp';
import { wire } from './harness/wire';
import type { FakeSocket } from './mocks/socketIo';
import { useOnlineGame } from './onlineSurface';

let live: FakeSocket;
async function mountProvider() {
  const view = await renderAppHook(() => useOnlineGame(), { user: { id: 'u1', username: 'Ana' }, online: true, connected: true });
  live = view.socket();
  return view;
}
const sentEvents = () => live.sent.map((e) => e.event);

/** A sanitized seatless view — what a spectate the server accepted answers with. */
const spectatorState = () => wire(state({ players: [seat(0), seat(1)] }), null);

describe('a refused spectate', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('leaves the next table by releasing the seat, not by unspectating', async () => {
    const { result, unmount } = await mountProvider();

    await act(async () => result.current.spectateRoom('ZZZZZZ'));
    await live.deliver('room:error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
    await waitFor(() => expect(result.current.isSpectator).toBe(false));

    live.reset();
    await act(async () => result.current.leaveRoom());

    expect(sentEvents()).toContain('room:leave');
    expect(sentEvents()).not.toContain('room:unspectate');

    await unmount();
  });

  // The refusal can be slow, or never rendered at all; taking a seat settles
  // the question on its own.
  it('does not survive into a room the player joins', async () => {
    const { result, unmount } = await mountProvider();

    await act(async () => result.current.spectateRoom('ZZZZZZ'));
    await waitFor(() => expect(result.current.isSpectator).toBe(true));

    await act(async () => {
      void result.current.joinRoom('ABCDEF');
    });
    await waitFor(() => expect(result.current.isSpectator).toBe(false));

    live.reset();
    await act(async () => result.current.leaveRoom());

    expect(sentEvents()).toContain('room:leave');
    expect(sentEvents()).not.toContain('room:unspectate');

    await unmount();
  });

  // The flag still has to do its job for someone who really is watching —
  // `room:leave` from a spectator runs the seated teardown for a table this
  // socket holds no seat at.
  it('leaves a table it is genuinely watching with room:unspectate', async () => {
    const { result, unmount } = await mountProvider();

    await act(async () => result.current.spectateRoom('ABCDEF'));
    await live.deliver('game:state', spectatorState(), () => {});
    await waitFor(() => expect(result.current.isSpectator).toBe(true));

    live.reset();
    await act(async () => result.current.leaveRoom());

    expect(sentEvents()).toContain('room:unspectate');
    expect(sentEvents()).not.toContain('room:leave');

    await unmount();
  });
});
