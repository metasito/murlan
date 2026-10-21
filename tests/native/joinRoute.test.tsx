// tests/native/joinRoute.test.tsx — /join/<CODE>, where a join link and a
// tapped invite both land, answers the invite and moves the player once.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { act } from '@testing-library/react-native';

import { useInvites } from '@/context/SocketContext';
import { renderAppHook } from './harness/renderApp';

const mockRedirects: unknown[] = [];
const mockState = {
  params: {} as Record<string, string>,
};

// The real Redirect replaces from a useFocusEffect whose callback is new each render, so a focused
// screen navigates again on every render.
jest.mock('expo-router', () => {
  const { useEffect } = require('react') as typeof import('react');
  return {
    useLocalSearchParams: () => mockState.params,
    Redirect: ({ href }: { href: unknown }) => {
      useEffect(() => void mockRedirects.push(href));
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
    renderAppHook(useInvites, { ...boot, wrap: (probe) => <><JoinScreen />{probe}</> });
  const redirects = (to: unknown) => {
    expect(mockRedirects.length).toBeGreaterThan(0);
    expect(new Set(mockRedirects.map((href) => JSON.stringify(href)))).toEqual(new Set([JSON.stringify(to)]));
  };

  it('accepts the invite for that room and takes a signed-in player to the online hub', async () => {
    const { result } = await join(signedIn);
    expect(result.current.accepted).toBe('QX7K2M');
    redirects('/(online)');
  });

  it('accepts once: the hub taking the invite is not undone by the route rendering again', async () => {
    const view = await join(signedIn);
    await act(async () => view.result.current.clearAccepted('QX7K2M'));
    await act(async () => view.rerender());
    expect(view.result.current.accepted).toBeNull();
    expect(mockRedirects.at(-1)).toBe('/(online)');
  });

  it('sends a signed-out player to sign in first, carrying the room back', async () => {
    const { result } = await join();
    expect(result.current.accepted).toBeNull();
    redirects({ pathname: '/auth', params: { next: '/join/QX7K2M' } });
  });

  it('lands a malformed code on home without joining anything', async () => {
    mockState.params = { code: 'AB/1' };
    const { result } = await join(signedIn);
    expect(result.current.accepted).toBeNull();
    redirects('/');
  });

  it('waits while the session is still being restored', async () => {
    const { result } = await join({ me: () => new Promise(() => {}), booted: false });
    expect(result.current.accepted).toBeNull();
    expect(mockRedirects).toEqual([]);
  });
});
