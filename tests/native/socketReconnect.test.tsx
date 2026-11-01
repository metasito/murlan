// tests/native/socketReconnect.test.tsx — who owns the retry once a socket is
// down.
//
// lib/socket.ts turns socket.io's own reconnection off, so SocketProvider is the
// one loop: every refused handshake and every disconnect the client did not ask
// for is retried on lib/reconnectDelay.ts's jitter, and the app coming to the
// foreground or the network changing retries a dropped socket at once.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { AppState, Platform, Text } from 'react-native';
import { act, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { reconnectDelayMs } from '@/lib/reconnectDelay';
import { renderApp } from './harness/renderApp';
import { netInfoListeners } from './mocks/netInfo';
import { lastSocket } from './mocks/socketIo';

const random = () => 0.123;
const mountAs = (id: string) => renderApp(<Text>child</Text>, { user: { id, username: 'Ana' }, random });
const mount = () => mountAs('u1');

// What identifies this handler's timers among the renderer's and react-query's.
const FIRST_RETRY_MS = reconnectDelayMs(0, random);
const SECOND_RETRY_MS = reconnectDelayMs(1, random);

it('draws retries that wait at all, and a second that waits longer', () => {
  expect(FIRST_RETRY_MS).toBeGreaterThan(0);
  expect(SECOND_RETRY_MS).toBeGreaterThan(FIRST_RETRY_MS);
});

let setTimeoutSpy: jest.Spied<typeof setTimeout>;

beforeEach(() => {
  jest.useFakeTimers();
  setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const scheduled = (ms: number) => setTimeoutSpy.mock.calls.filter((call) => call[1] === ms).length;
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const unmount = (view: Awaited<ReturnType<typeof mount>>) =>
  act(async () => {
    view.unmount();
  });

/** Mounted with a live connection, so a test starts from the socket a player has. */
async function connected() {
  const view = await mount();
  await act(async () => lastSocket().open());
  lastSocket().reset();
  return view;
}

describe('a failed connection attempt', () => {
  it('is retried after the jittered delay, even while socket.io still calls the socket active', async () => {
    const view = await mount();

    lastSocket().active = true;
    await act(async () => lastSocket().serverEmit('connect_error', new Error('websocket error')));
    expect(scheduled(FIRST_RETRY_MS)).toBe(1);
    expect(lastSocket().connect).not.toHaveBeenCalled();

    await advance(FIRST_RETRY_MS);
    expect(lastSocket().connect).toHaveBeenCalledTimes(1);
    await unmount(view);
  });

  it('backs off on each consecutive failure', async () => {
    const view = await mount();

    await act(async () => lastSocket().refuse(new Error('rejected')));
    await advance(FIRST_RETRY_MS);
    await act(async () => lastSocket().refuse(new Error('rejected')));
    expect(scheduled(SECOND_RETRY_MS)).toBe(1);

    await advance(SECOND_RETRY_MS);
    expect(lastSocket().connect).toHaveBeenCalledTimes(2);
    await unmount(view);
  });

  it('keeps its retry and its socket when the jitter source changes identity', async () => {
    const view = await mount();

    await act(async () => lastSocket().refuse(new Error('rejected')));
    await act(async () => {
      view.rerender(<Text>child</Text>, { random: () => 0.123 });
    });
    await advance(60_000);
    expect(lastSocket().disconnect).not.toHaveBeenCalled();
    expect(lastSocket().connect).toHaveBeenCalledTimes(1);
    await unmount(view);
  });
});

describe('a disconnect', () => {
  for (const reason of ['transport close', 'transport error', 'ping timeout', 'parse error', 'io server disconnect']) {
    it(`for "${reason}" is retried after the jittered delay`, async () => {
      const view = await connected();

      await act(async () => lastSocket().drop(reason));
      expect(scheduled(FIRST_RETRY_MS)).toBe(1);

      await advance(FIRST_RETRY_MS);
      expect(lastSocket().connect).toHaveBeenCalledTimes(1);
      await unmount(view);
    });
  }

  it('left pending when the provider went away is taken up by the next one', async () => {
    const first = await connected();
    await act(async () => lastSocket().drop('transport close'));
    await unmount(first);
    await advance(60_000);
    expect(lastSocket().connect).not.toHaveBeenCalled();

    const second = await mount();
    await advance(FIRST_RETRY_MS);
    expect(lastSocket().connect).toHaveBeenCalledTimes(1);
    await unmount(second);
  });

  it('the client asked for is not retried', async () => {
    const view = await connected();

    await act(async () => lastSocket().drop('io client disconnect'));
    await advance(60_000);
    expect(lastSocket().connect).not.toHaveBeenCalled();
    await unmount(view);
  });
});

describe('the device telling the app to try now', () => {
  const foreground = () => {
    const handlers = jest
      .mocked(AppState.addEventListener)
      .mock.calls.filter(([event]) => event === 'change')
      .map(([, handler]) => handler as (state: string) => void);
    return act(async () => handlers.forEach((handler) => handler('active')));
  };
  const networkChange = () =>
    act(async () => [...netInfoListeners()].forEach((listener) => listener({ isConnected: true })));

  for (const [label, signal] of [
    ['the app coming to the foreground', foreground],
    ['a network change', networkChange],
  ] as const) {
    it(`${label} reconnects a dropped socket at once and cancels the pending retry`, async () => {
      const view = await connected();
      await act(async () => lastSocket().drop('transport close'));
      expect(scheduled(FIRST_RETRY_MS)).toBe(1);

      await signal();
      expect(lastSocket().connect).toHaveBeenCalledTimes(1);

      await advance(60_000);
      expect(lastSocket().connect).toHaveBeenCalledTimes(1);
      await unmount(view);
    });

    it(`${label} leaves a live socket alone`, async () => {
      const view = await connected();

      await signal();
      expect(lastSocket().connect).not.toHaveBeenCalled();
      await unmount(view);
    });
  }
});

describe('on web, a handshake refused as unauthenticated', () => {
  it('halts the socket and sends the player to sign in', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    const view = await mountAs('web-u1');
    const socket = lastSocket();

    await act(async () => socket.refuse(new Error('Not authenticated')));
    expect(socket.disconnect).toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth'));

    await advance(60_000);
    expect(socket.connect).not.toHaveBeenCalled();
    await unmount(view);
    os.restore();
  });
});
