// tests/native/socketNoServer.test.tsx — a build with no server address (the device bench) opens no
// socket for a stored session; before, getApiUrl threw on mount and the root boundary took the screen.
import { it, expect, afterEach } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';

import { hasServer } from '@/lib/query-client';
import { renderApp } from './harness/renderApp';
import { fakeSockets } from './mocks/socketIo';

const domain = process.env.EXPO_PUBLIC_DOMAIN;
afterEach(() => {
  process.env.EXPO_PUBLIC_DOMAIN = domain;
});

it('mounts a signed-in user without a server address and opens no socket', async () => {
  delete process.env.EXPO_PUBLIC_DOMAIN;
  expect(hasServer()).toBe(false);
  const view = await renderApp(<Text>child</Text>, { user: { id: 'u1', username: 'Ana' } });
  expect(view.getByText('child')).toBeTruthy();
  expect(fakeSockets()).toHaveLength(0);
});

it('opens the socket once an address is set', async () => {
  process.env.EXPO_PUBLIC_DOMAIN = 'murlan.test';
  await renderApp(<Text>child</Text>, { user: { id: 'u1', username: 'Ana' } });
  expect(fakeSockets()).toHaveLength(1);
});
