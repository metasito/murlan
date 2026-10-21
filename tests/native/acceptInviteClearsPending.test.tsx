// tests/native/acceptInviteClearsPending.test.tsx — answering an invite answers
// it for both signals.
//
// `prompt` says one arrived and `accepted` says the player said
// yes, and the online hub acts on each: the first prefills the code and asks,
// the second joins. Leaving the first up while setting the second puts the two
// on the same room at the same time — a code prompt over a join already in
// flight (#398).
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { en as locale } from '@/locales/en';

import { useAuth } from '@/context/AuthContext';
import { useInvites } from '@/context/SocketContext';
import { queryClient as client } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { httpRequests, route } from './mocks/http';
import { lastSocket } from './mocks/socketIo';

const ANA = { id: 'u1', username: 'Ana' };
const BEN = { id: 'u2', username: 'Ben' };

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
    useSegments: () => ['(online)', 'friends'],
  };
});

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

const mockJoinRoom = jest.fn(async (_code: string): Promise<{ ok: boolean; code?: string } | null> => ({ ok: true }));
const mockOnline = { connected: false };
jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({
    joinRoom: mockJoinRoom,
    room: null,
    hasGame: false,
    isSpectator: false,
    entrySource: null,
  }),
  useOnlineConnection: () => ({
    connected: mockOnline.connected,
    rejoinFailed: false,
    clearRejoinFailed: () => {},
    clearError: () => {},
  }),
  useServerError: () => null,
}));

type Invites = ReturnType<typeof useInvites>;

/** `hook` rendered under the app, read back as `result.current`. */
const mountHook = async (hook: () => Invites, user: typeof ANA | null = ANA) => {
  const result = {} as { current: Invites };
  function Capture() {
    result.current = hook();
    return null;
  }
  const view = await renderApp(<Capture />, { user });
  return { result, unmount: view.unmount, signIn: view.signIn, signOut: view.signOut };
};
const mount = () => mountHook(useInvites);

/** A decline the test answers: `reject` fails it as a dropped connection does. */
const heldDecline = () => {
  const held = { reject: (_reason: Error) => {} };
  route('DELETE', '/api/friends/invites/ABC123', () => new Promise((_resolve, reject) => (held.reject = reject)));
  return held;
};

/** What the server sends when a friend invites this player to their table. */
const invite = async () => {
  await act(async () => {
    lastSocket().serverEmit('friend:invite', { from: 'ana', roomCode: 'ABC123' });
  });
};

beforeEach(() => {
  route('DELETE', '/api/friends/invites/ABC123', { body: {} });
  mockJoinRoom.mockClear();
  mockOnline.connected = false;
});

describe('accepting an invite', () => {
  it('takes the arrival down with it', async () => {
    const { result, unmount } = await mount();
    await invite();
    expect(result.current.prompt).not.toBeNull();

    await act(async () => result.current.accept('ABC123'));

    expect(result.current.accepted).toBe('ABC123');
    expect(result.current.prompt).toBeNull();

    await unmount();
  });

  it('leaves an invite to another room standing', async () => {
    const { result, unmount } = await mount();
    await invite();
    await act(async () => {
      lastSocket().serverEmit('friend:invite', { from: 'bob', roomCode: 'XYZ789' });
    });

    await act(async () => result.current.accept('ABC123'));

    expect(result.current.prompt).toEqual({ from: 'bob', roomCode: 'XYZ789' });

    await unmount();
  });

  it('takes the invite off the list without declining the seat it holds', async () => {
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, unmount } = await mount();
    expect(result.current.invites).toHaveLength(1);

    await act(async () => result.current.accept('ABC123'));

    expect(result.current.invites).toEqual([]);
    expect(httpRequests().filter((r) => r.method === 'DELETE' && r.path === '/api/friends/invites/ABC123')).toEqual([]);

    await unmount();
  });

  it('keeps an accepted invite off the list when a refetch still returns its row', async () => {
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    client.setQueryData(['/api/friends/invites'], [row]);
    const { result, unmount } = await mount();
    const serverStillReturnsRow = () =>
      act(async () => {
        client.setQueryData(['/api/friends/invites'], [row]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    await act(async () => result.current.accept('ABC123'));
    await serverStillReturnsRow();
    expect(result.current.invites).toEqual([]);

    await invite();
    await serverStillReturnsRow();
    expect(result.current.invites).toEqual([{ from: 'ana', roomCode: 'ABC123' }]);

    await unmount();
  });

  it('puts a declined invite back when the decline never reached the server', async () => {
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, unmount } = await mount();
    const decline = heldDecline();

    await act(async () => result.current.dismiss('ABC123'));
    expect(result.current.invites).toEqual([]);

    await act(async () => decline.reject(new Error('offline')));
    expect(result.current.invites).toEqual([{ from: 'ana', roomCode: 'ABC123' }]);

    await unmount();
  });

  it('leaves an invite nobody answered standing', async () => {
    const { result, unmount } = await mount();
    await invite();

    expect(result.current.prompt).toEqual({ from: 'ana', roomCode: 'ABC123' });
    expect(result.current.accepted).toBeNull();

    await unmount();
  });
});

describe('hidden invites across accounts', () => {
  it("leaves the next account's hidden invites alone when an old decline fails", async () => {
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, signIn, signOut, unmount } = await mount();
    const decline = heldDecline();
    await act(async () => result.current.dismiss('ABC123'));

    await signOut();
    await signIn(BEN);
    await act(async () => {
      client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'cleo', roomCode: 'XYZ789' }]);
    });
    await act(async () => result.current.accept('XYZ789'));
    expect(result.current.invites).toEqual([]);

    await act(async () => decline.reject(new Error('unauthorized')));
    expect(result.current.invites).toEqual([]);

    await unmount();
  });

  it('keeps a hide when the same account signs out and back in', async () => {
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    client.setQueryData(['/api/friends/invites'], [row]);
    const { result, signIn, signOut, unmount } = await mount();
    await act(async () => result.current.accept('ABC123'));

    await signOut();
    await signIn(ANA);
    await act(async () => {
      client.setQueryData(['/api/friends/invites'], [row]);
    });

    expect(result.current.invites).toEqual([]);

    await unmount();
  });

  it('hides an invite accepted by a child in the commit that signs the account in', async () => {
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'cleo', roomCode: 'XYZ789' }]);
    const { result, signIn, unmount } = await mountHook(() => {
      const invites = useInvites();
      const { accept } = invites;
      const signedIn = useAuth().user !== null;
      React.useEffect(() => {
        if (signedIn) accept('XYZ789');
      }, [signedIn, accept]);
      return invites;
    }, null);

    expect(result.current.invites).toEqual([{ from: 'cleo', roomCode: 'XYZ789' }]);

    await signIn(BEN);

    expect(result.current.accepted).toBe('XYZ789');
    expect(result.current.invites).toEqual([]);

    await unmount();
  });
});

describe('accepting from the friends screen', () => {
  const mountFriends = async () => {
    const FriendsScreen = (require('@/app/(online)/friends') as { default: React.ComponentType }).default;
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    route('GET', '/api/friends/invites', { body: [row] });
    for (const path of ['/api/friends', '/api/friends/requests', '/api/friends/sent']) route('GET', path, { body: [] });
    const seen: { current: ReturnType<typeof useInvites> | null } = { current: null };
    const { useOnlineRouting } =
      require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');
    const Probe = () => {
      seen.current = useInvites();
      useOnlineRouting();
      return null;
    };
    const tree = () => (
      <>
        <Probe />
        <FriendsScreen />
      </>
    );
    const view = await renderApp(tree(), { user: ANA });
    return { view, seen, rerender: () => view.rerender(tree()) };
  };

  it('answers the invite for both signals, as the home card does', async () => {
    const { view, seen } = await mountFriends();
    await invite();
    expect(seen.current?.prompt).not.toBeNull();

    await fireEvent.press(screen.getByLabelText(/join ana/i));

    expect(seen.current?.prompt).toBeNull();
    expect(seen.current?.accepted).toBe('ABC123');
    expect(mockJoinRoom).not.toHaveBeenCalled();

    await view.unmount();
  });

  it('joins from the layout once the socket is up, and only once', async () => {
    const { view, seen, rerender } = await mountFriends();
    await invite();

    await fireEvent.press(screen.getByLabelText(/join ana/i));
    expect(mockJoinRoom).not.toHaveBeenCalled();

    mockOnline.connected = true;
    await rerender();
    await rerender();

    expect(mockJoinRoom).toHaveBeenCalledTimes(1);
    expect(mockJoinRoom).toHaveBeenCalledWith('ABC123');
    expect(seen.current?.accepted).toBeNull();

    await view.unmount();
  });

  for (const answer of [{ ok: true }, { ok: false, code: 'ROOM_FULL' }]) {
    it(`says it is joining until the join is answered (${answer.code ?? 'ok'}), though no room fact moves`, async () => {
      const JOINING = locale['onlineLobby.joiningInvite'];
      let reply: (outcome: typeof answer) => void = () => {};
      mockJoinRoom.mockImplementationOnce(() => new Promise((resolve) => (reply = resolve)));
      mockOnline.connected = true;
      const { view, seen, rerender } = await mountFriends();
      await invite();

      await fireEvent.press(screen.getByLabelText(/join ana/i));
      await rerender();

      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
      expect(seen.current?.accepted).toBe('ABC123');
      expect(screen.queryAllByText(JOINING).length).toBeGreaterThan(0);

      await act(async () => reply(answer));

      expect(seen.current?.accepted).toBeNull();
      expect(screen.queryAllByText(JOINING)).toHaveLength(0);
      expect(mockJoinRoom).toHaveBeenCalledTimes(1);
      await view.unmount();
    });
  }
});
