// tests/native/socketCallers.test.tsx — Riprova and a halt go through lib/socket.ts's teardown.
//
// A websocket closed while it is still connecting makes the browser log an error, so both wait for
// the attempt to settle; a later retry takes the attempt over instead of being closed under it.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';
import { reconnectDelayMs } from '@/lib/reconnectDelay';
import { useOnlineGame } from './onlineSurface';
import { renderAppHook } from './harness/renderApp';

const random = () => 0.123;
const REPLACED = { code: 'SESSION_REPLACED', message: 'Il tuo account è stato aperto altrove.' };
let accounts = 0;

// lib/socket.ts keeps one socket per account for the whole file, so each test is its own account.
const mount = (connected: boolean) =>
  renderAppHook(useOnlineGame, { user: { id: `caller${++accounts}`, username: 'Ana' }, online: true, connected, random });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Riprova', () => {
  it('abandons an attempt that is still opening for a fresh one, and closes the old one once it settles', async () => {
    const view = await mount(false);
    const socket = view.socket();
    const hung = socket.io.engine!;
    expect(hung.readyState).toBe('opening');
    socket.reset();

    await act(async () => view.result.current.retryConnection());

    const fresh = socket.io.engine!;
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(fresh).not.toBe(hung);
    expect(fresh.readyState).toBe('opening');
    expect(hung.close).not.toHaveBeenCalled();
    hung.open();
    expect(hung.close).toHaveBeenCalledTimes(1);
    await act(async () => socket.open());
    expect(socket.connected).toBe(true);
    expect(fresh.close).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('on a halted socket connects it and lets the next drop retry', async () => {
    const view = await mount(true);
    const socket = view.socket();
    await act(async () => socket.serverEmit('socket:error', REPLACED));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    socket.reset();

    await act(async () => view.result.current.retryConnection());
    expect(socket.connect).toHaveBeenCalledTimes(1);
    await act(async () => socket.open());
    socket.reset();

    await act(async () => socket.drop('transport close'));
    await act(async () => void jest.advanceTimersByTime(reconnectDelayMs(0, random)));
    expect(socket.connect).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe('a halt while the socket is opening', () => {
  it('waits for the websocket to settle before closing it, and does not retry', async () => {
    const view = await mount(false);
    const socket = view.socket();
    socket.reset();

    await act(async () => socket.serverEmit('socket:error', REPLACED));
    expect(socket.disconnect).not.toHaveBeenCalled();

    await act(async () => socket.open());
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);
    await act(async () => void jest.advanceTimersByTime(60_000));
    expect(socket.connect).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('is cancelled by the player taking the account back', async () => {
    const view = await mount(false);
    const socket = view.socket();
    socket.reset();
    await act(async () => socket.serverEmit('socket:error', REPLACED));

    await act(async () => fireEvent.press(view.getByLabelText(locale['sessionReplaced.reconnect'])));
    await act(async () => socket.open());

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connected).toBe(true);
    await view.unmount();
  });

  it('is cancelled by Riprova, which opens a fresh attempt', async () => {
    const view = await mount(false);
    const socket = view.socket();
    const hung = socket.io.engine!;
    socket.reset();
    await act(async () => socket.serverEmit('socket:error', REPLACED));

    await act(async () => view.result.current.retryConnection());
    hung.open();
    await act(async () => socket.open());

    expect(hung.close).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
    await view.unmount();
  });
});
