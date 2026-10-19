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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Listener = (...args: unknown[]) => void;

const mockSocket = {
  connected: true,
  active: true,
  listeners: new Map<string, Listener>(),
  on(event: string, fn: Listener) {
    this.listeners.set(event, fn);
  },
  off() {},
  emit() {},
  connect: jest.fn(),
  disconnect: jest.fn(),
  io: { reconnection: jest.fn() },
};

jest.mock('@/lib/socket', () => ({
  connectSocket: () => mockSocket,
  disconnectSocket: () => {},
  peekSocket: (userId?: string | null) => (userId ? mockSocket : null),
  subscribeToSockets: () => () => {},
}));

const mockApiRequest = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/query-client', () => ({
  ...(jest.requireActual('@/lib/query-client') as object),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const ANA = { id: 'u1', username: 'Ana' };
let mockUser: { id: string; username: string } | null = ANA;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, logout: async () => {} }),
}));

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

const mockJoinRoom = jest.fn();
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
  }),
}));

const { SocketProvider, useInvites } =
  require('@/context/SocketContext') as typeof import('@/context/SocketContext');
const { NotificationProvider } =
  require('@/context/NotificationContext') as typeof import('@/context/NotificationContext');

const mount = (client = new QueryClient()) => {
  // Out here, not in the wrapper's body, which React re-runs on every render.
  return renderHook(() => useInvites(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <SocketProvider>{children}</SocketProvider>
        </NotificationProvider>
      </QueryClientProvider>
    ),
  });
};

/** What the server sends when a friend invites this player to their table. */
const invite = async () => {
  await act(async () => {
    mockSocket.listeners.get('friend:invite')?.({ from: 'ana', roomCode: 'ABC123' });
  });
};

beforeEach(() => {
  mockSocket.listeners.clear();
  mockUser = ANA;
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
      mockSocket.listeners.get('friend:invite')?.({ from: 'bob', roomCode: 'XYZ789' });
    });

    await act(async () => result.current.accept('ABC123'));

    expect(result.current.prompt).toEqual({ from: 'bob', roomCode: 'XYZ789' });

    await unmount();
  });

  it('takes the invite off the list without declining the seat it holds', async () => {
    const client = new QueryClient();
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, unmount } = await mount(client);
    expect(result.current.invites).toHaveLength(1);

    await act(async () => result.current.accept('ABC123'));

    expect(result.current.invites).toEqual([]);
    expect(mockApiRequest).not.toHaveBeenCalledWith('DELETE', '/api/friends/invites/ABC123');

    await unmount();
  });

  it('keeps an accepted invite off the list when a refetch still returns its row', async () => {
    const client = new QueryClient();
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    client.setQueryData(['/api/friends/invites'], [row]);
    const { result, unmount } = await mount(client);
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
    const client = new QueryClient();
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, unmount } = await mount(client);
    let rejectDecline: (reason: Error) => void = () => {};
    mockApiRequest.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectDecline = reject))
    );

    await act(async () => result.current.dismiss('ABC123'));
    expect(result.current.invites).toEqual([]);

    await act(async () => rejectDecline(new Error('offline')));
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
    const client = new QueryClient();
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'ana', roomCode: 'ABC123' }]);
    const { result, rerender, unmount } = await mount(client);
    let rejectDecline: (reason: Error) => void = () => {};
    mockApiRequest.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectDecline = reject))
    );
    await act(async () => result.current.dismiss('ABC123'));

    mockUser = null;
    await act(async () => rerender({}));
    mockUser = { id: 'u2', username: 'Ben' };
    await act(async () => rerender({}));
    await act(async () => {
      client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'cleo', roomCode: 'XYZ789' }]);
    });
    await act(async () => result.current.accept('XYZ789'));
    expect(result.current.invites).toEqual([]);

    await act(async () => rejectDecline(new Error('unauthorized')));
    expect(result.current.invites).toEqual([]);

    await unmount();
  });

  it('keeps a hide when the same account signs out and back in', async () => {
    const client = new QueryClient();
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    client.setQueryData(['/api/friends/invites'], [row]);
    const { result, rerender, unmount } = await mount(client);
    await act(async () => result.current.accept('ABC123'));

    mockUser = null;
    await act(async () => rerender({}));
    mockUser = ANA;
    await act(async () => rerender({}));
    await act(async () => {
      client.setQueryData(['/api/friends/invites'], [row]);
    });

    expect(result.current.invites).toEqual([]);

    await unmount();
  });

  it('hides an invite accepted by a child in the commit that signs the account in', async () => {
    const { useAuth } = require('@/context/AuthContext') as typeof import('@/context/AuthContext');
    mockUser = null;
    const client = new QueryClient();
    client.setQueryData(['/api/friends/invites'], [{ fromUsername: 'cleo', roomCode: 'XYZ789' }]);
    const { result, rerender, unmount } = await renderHook(
      () => {
        const invites = useInvites();
        const { accept } = invites;
        const signedIn = useAuth().user !== null;
        React.useEffect(() => {
          if (signedIn) accept('XYZ789');
        }, [signedIn, accept]);
        return invites;
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={client}>
            <NotificationProvider>
              <SocketProvider>{children}</SocketProvider>
            </NotificationProvider>
          </QueryClientProvider>
        ),
      }
    );

    expect(result.current.invites).toEqual([{ from: 'cleo', roomCode: 'XYZ789' }]);

    mockUser = { id: 'u2', username: 'Ben' };
    await act(async () => rerender({}));

    expect(result.current.accepted).toBe('XYZ789');
    expect(result.current.invites).toEqual([]);

    await unmount();
  });
});

describe('accepting from the friends screen', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  };

  const mountFriends = async () => {
    const FriendsScreen = (require('@/app/(online)/friends') as { default: React.ComponentType }).default;
    const row = { fromUsername: 'ana', roomCode: 'ABC123' };
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey }) => (queryKey[0] === '/api/friends/invites' ? [row] : []),
        },
      },
    });
    const seen: { current: ReturnType<typeof useInvites> | null } = { current: null };
    const { useOnlineRouting } =
      require('@/context/useOnlineRouting') as typeof import('@/context/useOnlineRouting');
    const Probe = () => {
      seen.current = useInvites();
      useOnlineRouting();
      return null;
    };
    const tree = () => (
      <QueryClientProvider client={client}>
        <NotificationProvider>
          <SocketProvider>
            <SafeAreaProvider initialMetrics={METRICS}>
              <Probe />
              <FriendsScreen />
            </SafeAreaProvider>
          </SocketProvider>
        </NotificationProvider>
      </QueryClientProvider>
    );
    const view = await render(tree());
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
});
