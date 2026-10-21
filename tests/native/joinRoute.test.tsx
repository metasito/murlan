// tests/native/joinRoute.test.tsx — /join/<CODE>, where a join link and a
// tapped invite both land, answers the invite and moves the player once.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';

import { useInvites } from '@/context/SocketContext';
import { renderAppHook } from './harness/renderApp';

const mockRedirects: unknown[] = [];
const mockState = {
  params: {} as Record<string, string>,
};

// expo-router's Redirect navigates once, when it mounts, however often its screen re-renders.
jest.mock('expo-router', () => {
  const { useEffect, useRef } = require('react') as typeof import('react');
  return {
    useLocalSearchParams: () => mockState.params,
    Redirect: ({ href }: { href: unknown }) => {
      const went = useRef(false);
      useEffect(() => {
        if (went.current) return;
        went.current = true;
        mockRedirects.push(href);
      });
      return null;
    },
  };
});

import JoinScreen from '@/app/join/[code]';

describe('the /join/<CODE> route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedirects.length = 0;
    mockState.params = { code: 'qx7k2m' };
  });
  const signedIn = { user: { id: 'u1', username: 'Ana' } };
  const join = (boot = {}) =>
    renderAppHook(() => useInvites().accepted, { ...boot, wrap: (probe) => <><JoinScreen />{probe}</> });

  it('accepts the invite for that room and takes a signed-in player to the online hub', async () => {
    const { result } = await join(signedIn);
    expect(result.current).toBe('QX7K2M');
    expect(mockRedirects).toEqual(['/(online)']);
  });

  it('sends a signed-out player to sign in first, carrying the room back', async () => {
    const { result } = await join();
    expect(result.current).toBeNull();
    expect(mockRedirects).toEqual([{ pathname: '/auth', params: { next: '/join/QX7K2M' } }]);
  });

  it('lands a malformed code on home without joining anything', async () => {
    mockState.params = { code: 'AB/1' };
    const { result } = await join(signedIn);
    expect(result.current).toBeNull();
    expect(mockRedirects).toEqual(['/']);
  });

  it('waits while the session is still being restored', async () => {
    const { result } = await join({ me: () => new Promise(() => {}), booted: false });
    expect(result.current).toBeNull();
    expect(mockRedirects).toEqual([]);
  });
});
