import { afterEach, describe, it, expect, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { connectSocket, disconnectSocket, peekSocket } from '@/lib/socket';
import { lastSocket } from './mocks/socketIo';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Whether a connection attempt made now would ever be handed credentials, and so send its CONNECT. */
async function handsOverCredentials(socket: ReturnType<typeof lastSocket>): Promise<boolean> {
  let handed = false;
  void socket.handshake().then(() => (handed = true));
  await flush();
  return handed;
}

describe('signing out while the socket is still opening', () => {
  let os: { restore(): void } | undefined;
  afterEach(() => {
    os?.restore();
    os = undefined;
  });

  it('leaves the opening websocket alone, then closes it once it opens', async () => {
    os = jest.replaceProperty(Platform, 'OS', 'web');
    const onAuthFailure = jest.fn();
    connectSocket('opening1', { onAuthFailure });
    const socket = lastSocket();
    const onConnect = jest.fn();
    socket.on('connect', onConnect);
    expect(socket.io.engine.readyState).toBe('opening');

    disconnectSocket('opening1');

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(peekSocket('opening1')).toBeNull();
    expect(socket.listening('connect')).toBe(0);
    expect(await handsOverCredentials(socket)).toBe(false);

    socket.open();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);
    expect(onConnect).not.toHaveBeenCalled();
    socket.refuse(new Error('Not authenticated'));
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('closes it once the opening fails', () => {
    connectSocket('opening2', { onAuthFailure: () => {} });
    const socket = lastSocket();

    disconnectSocket('opening2');
    expect(socket.disconnect).not.toHaveBeenCalled();

    socket.failToOpen(new Error('websocket error'));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    socket.open();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('withholds a ticket that lands after the sign-out', async () => {
    connectSocket('opening3', { onAuthFailure: () => {} });
    const socket = lastSocket();
    let handed = false;
    void socket.credentials!.then(() => (handed = true));

    disconnectSocket('opening3');
    await flush();

    expect(handed).toBe(false);
  });
});

describe('signing out once the socket has opened', () => {
  it('closes it at once', () => {
    connectSocket('open1', { onAuthFailure: () => {} });
    const socket = lastSocket();
    socket.open();
    expect(socket.connected).toBe(true);

    disconnectSocket('open1');

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);
  });
});
