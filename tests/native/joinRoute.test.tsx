// tests/native/joinRoute.test.tsx — /join/<CODE>, where a join link and a
// tapped invite both land, answers the invite and moves the player once.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';

import { renderApp } from './harness/renderApp';

const mockAcceptInvite = jest.fn();
const mockRedirects: unknown[] = [];
const mockState = {
  params: {} as Record<string, string>,
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockState.params,
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirects.push(href);
    return null;
  },
}));
jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  useInvites: () => ({ accept: mockAcceptInvite }),
}));

import JoinScreen from '@/app/join/[code]';

describe('the /join/<CODE> route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedirects.length = 0;
    mockState.params = { code: 'qx7k2m' };
  });
  const signedIn = { user: { id: 'u1', username: 'Ana' } };

  it('accepts the invite for that room and takes a signed-in player to the online hub', async () => {
    await renderApp(<JoinScreen />, signedIn);
    expect(mockAcceptInvite).toHaveBeenCalledTimes(1);
    expect(mockAcceptInvite).toHaveBeenCalledWith('QX7K2M');
    expect(mockRedirects).toEqual(['/(online)']);
  });

  it('sends a signed-out player to sign in first, carrying the room back', async () => {
    await renderApp(<JoinScreen />);
    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockRedirects).toEqual([{ pathname: '/auth', params: { next: '/join/QX7K2M' } }]);
  });

  it('lands a malformed code on home without joining anything', async () => {
    mockState.params = { code: 'AB/1' };
    await renderApp(<JoinScreen />, signedIn);
    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockRedirects).toEqual(['/']);
  });

  it('waits while the session is still being restored', async () => {
    await renderApp(<JoinScreen />, { me: () => new Promise(() => {}), booted: false });
    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockRedirects).toEqual([]);
  });
});
