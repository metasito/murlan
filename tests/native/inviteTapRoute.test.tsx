// tests/native/inviteTapRoute.test.tsx — a tapped friend-invite push opens the
// same /join/<CODE> route a join link resolves to, exactly once.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Linking } from 'react-native';

const mockListeners = new Set<(response: unknown) => void>();
const mockLaunch: { response: unknown } = { response: null };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
}));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: () => mockLaunch.response,
  clearLastNotificationResponse: () => {
    mockLaunch.response = null;
  },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockListeners.add(listener);
    return { remove: () => mockListeners.delete(listener) };
  },
}));

import { router as mockRouter } from 'expo-router';
import { followInviteTaps } from '@/lib/device/inviteTaps';
import { redirectSystemPath } from '@/app/+native-intent';

const tap = (identifier: string, data: Record<string, unknown>) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { request: { identifier, content: { data } } },
});
const deliver = (response: unknown) => mockListeners.forEach((listener) => listener(response));

describe('followInviteTaps', () => {
  let openURL: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    mockLaunch.response = null;
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  it('opens the join route for the invited room, and navigates nowhere else', () => {
    const stop = followInviteTaps();
    expect(mockListeners.size).toBe(1);

    deliver(tap('n1', { code: 'FRIEND_INVITE', roomCode: 'qx7k2m', from: 'ana' }));

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/join/QX7K2M');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
    stop();
    expect(mockListeners.size).toBe(0);
  });

  it('takes a tap to the very route redirectSystemPath gives the same join link', () => {
    const stop = followInviteTaps();
    deliver(tap('n6', { code: 'FRIEND_INVITE', roomCode: 'qx7k2m' }));

    const linked = ['murlan://join/qx7k2m', '/join/QX7K2M', 'join/qx7k2m'].map((path) =>
      redirectSystemPath({ path, initial: true }),
    );
    expect(linked).toEqual(['/join/QX7K2M', '/join/QX7K2M', '/join/QX7K2M']);
    expect(mockRouter.push).toHaveBeenCalledWith(linked[0]);
    expect(redirectSystemPath({ path: 'murlan://rules', initial: true })).toBe('/');
    stop();
  });

  it('ignores a push of another kind, and an invite with no usable room code', () => {
    const stop = followInviteTaps();
    expect(mockListeners.size).toBe(1);

    deliver(tap('n2', { code: 'SOMETHING_ELSE', roomCode: 'QX7K2M' }));
    deliver(tap('n3', { code: 'FRIEND_INVITE', roomCode: '../auth' }));
    deliver(tap('n4', { code: 'FRIEND_INVITE' }));

    expect(mockRouter.push).not.toHaveBeenCalled();
    stop();
  });

  it('follows the tap that launched the app once, though the listener reports it too', () => {
    const launch = tap('n5', { code: 'FRIEND_INVITE', roomCode: 'QX7K2M' });
    mockLaunch.response = launch;

    const stop = followInviteTaps();
    deliver(launch);

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/join/QX7K2M');
    stop();
  });
});
