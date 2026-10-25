// tests/native/harness.test.tsx — renderApp mounts the app's own providers over the faked network.
import { describe, it, expect, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';
import { useAuth } from '@/context/AuthContext';
import { useBanner } from '@/context/NotificationContext';
import { useInvites, useSocketConnection } from '@/context/SocketContext';
import { useSettings } from '@/context/SettingsContext';
import { useGameSession } from '@/context/GameContext';
import { INTENT_ACK_TIMEOUT_MS, send, type IntentOutcome } from '@/lib/sendIntent';
import { useOwnLink } from '@/lib/useOwnLink';
import { renderApp } from './harness/renderApp';
import { route } from './mocks/http';

const ANA = { id: 'u1', username: 'Ana' };

const seen = {} as { socket: ReturnType<typeof useSocketConnection>; invites: ReturnType<typeof useInvites> };

function Probe() {
  useSettings();
  useGameSession();
  const { user } = useAuth();
  const { notification } = useBanner();
  const socket = useSocketConnection();
  const invites = useInvites();
  useEffect(() => {
    seen.socket = socket;
    seen.invites = invites;
  });
  return (
    <>
      <Text testID="user">{user?.username ?? 'none'}</Text>
      <Text testID="invite">{invites.prompt?.roomCode ?? 'none'}</Text>
      <Text testID="banner">{notification?.message ?? 'none'}</Text>
    </>
  );
}

const text = (view: Awaited<ReturnType<typeof renderApp>>, id: string) => view.getByTestId(id).props.children;

describe('renderApp', () => {
  it('boots the account the server confirms, and opens its socket', async () => {
    const view = await renderApp(<Probe />, { user: ANA });

    expect(text(view, 'user')).toBe('Ana');
    expect(seen.socket).toBe(view.socket());
  });

  it('carries a server event through socket, notifications and auth to the screen', async () => {
    const view = await renderApp(<Probe />, { user: ANA });

    await act(async () => view.socket().serverEmit('friend:invite', { from: 'Cleo', roomCode: 'ABCD' }));

    expect(text(view, 'invite')).toBe('ABCD');
    expect(text(view, 'banner')).toBe(locale['notifications.gameInviteBody'].replace('{{code}}', 'ABCD'));
  });

  it('signs the player out when the socket ticket is refused', async () => {
    const view = await renderApp(<Probe />, { user: ANA });
    route('POST', '/api/auth/socket-ticket', { status: 401 });

    await act(async () => {
      void view.socket().handshake();
    });

    expect(text(view, 'user')).toBe('none');
  });

  it('opens no socket for a signed-out player', async () => {
    const view = await renderApp(<Probe />);

    expect(text(view, 'user')).toBe('none');
    expect(seen.socket).toBeNull();
  });
});

describe('the faked network', () => {
  it('rejects a request no test routed, as a device with no network does', async () => {
    await expect(fetch('https://murlan.test/api/anything')).rejects.toThrow('Network request failed');
  });

  it('answers a routed request', async () => {
    route('GET', '/api/ping', { body: { pong: true } });

    const res = await fetch('https://murlan.test/api/ping?x=1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });
});

describe('an intent the server never acknowledges', () => {
  it('is sent again under the same id, then given up as undelivered', async () => {
    const view = await renderApp(<Probe />, { user: ANA });
    jest.useFakeTimers();

    let outcome: IntentOutcome | undefined;
    void send(seen.socket, 'game:pass', { seq: 0 }).then((o) => (outcome = o));
    for (let attempt = 0; attempt < 3; attempt++) {
      await act(async () => jest.advanceTimersByTime(INTENT_ACK_TIMEOUT_MS));
    }

    const sent = view.socket().sentAs('game:pass');
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((p) => p.intentId)).size).toBe(1);
    expect(outcome).toEqual({ ok: false });
  });

  it('tells the player an invite never arrived', async () => {
    const view = await renderApp(<Probe />, { user: ANA });
    jest.useFakeTimers();

    let delivered: boolean | undefined;
    await act(async () => {
      void seen.invites.send('f1', 'ABCD').then((ok) => (delivered = ok));
    });
    await act(async () => jest.advanceTimersByTime(INTENT_ACK_TIMEOUT_MS));

    expect(view.socket().acks[0].settled).toBe(true);
    expect(delivered).toBe(false);
    expect(text(view, 'banner')).toBe(locale['room.requestNotDelivered']);
  });
});

function LinkProbe() {
  const { connected } = useOwnLink(useSocketConnection());
  return <Text testID="link">{connected ? 'up' : 'down'}</Text>;
}

describe("a socket's subscribers outlive the test that made them", () => {
  it('follows the link in the first test', async () => {
    const view = await renderApp(<LinkProbe />, { user: ANA });

    await act(async () => view.socket().open());

    expect(text(view, 'link')).toBe('up');
  });

  it('still follows it in the next, on the same account’s socket', async () => {
    const view = await renderApp(<LinkProbe />, { user: ANA });

    await act(async () => view.socket().drop('transport close'));
    expect(text(view, 'link')).toBe('down');

    await act(async () => view.socket().open());
    expect(text(view, 'link')).toBe('up');
  });
});
