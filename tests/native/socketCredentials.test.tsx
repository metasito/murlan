import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { connectSocket, disconnectSocket } from '@/lib/socket';
import { httpRequests } from './mocks/http';
import { lastSocket } from './mocks/socketIo';

const flush = () => new Promise((r) => setTimeout(r, 0));
const ticketRequests = () => httpRequests().filter((r) => r.path === '/api/auth/socket-ticket').length;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('what each connection attempt hands the handshake', () => {
  it('on web, the cookie alone: no ticket is minted on any attempt', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    connectSocket('web1', { onAuthFailure: () => {} });
    const socket = lastSocket();

    const first = await socket.credentials!;
    const second = await socket.handshake();
    await flush();

    expect(first.ticket).toBeUndefined();
    expect(second.ticket).toBeUndefined();
    expect(first.protocolVersion).toEqual(expect.any(Number));
    expect(ticketRequests()).toBe(0);
    disconnectSocket('web1');
    os.restore();
  });

  it('on a native platform, one fresh ticket per attempt', async () => {
    connectSocket('native1', { onAuthFailure: () => {} });
    const socket = lastSocket();

    expect((await socket.credentials!).ticket).toBe('ticket');
    expect((await socket.handshake()).ticket).toBe('ticket');
    expect(ticketRequests()).toBe(2);
    disconnectSocket('native1');
  });

  it("leaves every retry to the app: socket.io's own reconnection is off", () => {
    connectSocket('native2', { onAuthFailure: () => {} });
    expect(lastSocket().options.reconnection).toBe(false);
    disconnectSocket('native2');
  });
});

describe('a session the server no longer knows', () => {
  it('on web, a handshake refused as unauthenticated is the auth failure', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    const onAuthFailure = jest.fn();
    connectSocket('web2', { onAuthFailure });

    lastSocket().refuse(new Error('AUTH_UNAVAILABLE'));
    expect(onAuthFailure).not.toHaveBeenCalled();
    lastSocket().refuse(new Error('Not authenticated'));
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    disconnectSocket('web2');
    os.restore();
  });

  it('on a native platform, the ticket answer decides it, not the refusal', async () => {
    const onAuthFailure = jest.fn();
    connectSocket('native3', { onAuthFailure });
    await lastSocket().credentials;

    lastSocket().refuse(new Error('Not authenticated'));
    expect(onAuthFailure).not.toHaveBeenCalled();
    disconnectSocket('native3');
  });
});
