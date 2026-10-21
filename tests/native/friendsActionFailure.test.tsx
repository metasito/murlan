// tests/native/friendsActionFailure.test.tsx — a friend action the server
// refused puts the row back and says so; a pending list that failed to load
// says that instead of "nothing pending".
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryClient as qc } from '@/lib/query-client';
import { bannerLog } from './harness/bannerLog';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { route, unreachable } from './mocks/http';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, []),
  };
});

jest.mock('@/lib/device/pushRegistration', () => ({
  registerForPush: async () => {},
  forgetPushRegistration: () => {},
}));

jest.mock('@/context/SocketContext', () => ({
  ...jest.requireActual<object>('@/context/SocketContext'),
  usePresence: () => ({ onlineIds: new Set(), refresh: () => {} }),
  useInvites: () => ({ invites: [], dismiss: jest.fn(), accept: jest.fn() }),
}));

jest.mock('@/context/onlineGameHooks', () => ({
  useOnlineRoom: () => ({ joinRoom: jest.fn(), room: null }),
  useOnlineConnection: () => ({ clearError: jest.fn() }),
  useServerError: () => null,
}));

// No route answers an action: every one of them is lost on the way, as offline.
const { shown, BannerLog } = bannerLog();

import FriendsScreen from '@/app/(online)/friends';


const SEED: Record<string, unknown[]> = {
  '/api/friends': [{ id: 'f1', username: 'Besi', lastSeen: null }],
  '/api/friends/requests': [{ id: 'r1', username: 'Dora', createdAt: '2026-09-01T10:00:00.000Z' }],
  '/api/friends/sent': [{ id: 's1', username: 'Gent', createdAt: '2026-09-01T10:00:00.000Z' }],
};

async function mount(failing: string[] = [], seed: Record<string, unknown[]> = SEED) {
  for (const key of Object.keys(seed)) {
    if (failing.includes(key)) {
      route('GET', key, unreachable);
    } else {
      route('GET', key, { body: seed[key] });
      qc.setQueryData([key], seed[key]);
    }
  }
  await setWindow({ width: 390, height: 844 });
  return renderApp(
    <>
      <BannerLog />
      <FriendsScreen />
    </>,
    { user: { id: 'u1', username: 'Ana' } }
  );
}

describe('a refused friend action is undone and reported', () => {
  beforeEach(() => {
    shown.length = 0;
  });

  const cases: [string, RegExp, string][] = [
    ['accept', /accept dora/i, 'Dora'],
    ['decline', /decline dora/i, 'Dora'],
    ['cancel', /cancel your request to gent/i, 'Gent'],
  ];
  for (const [name, label, username] of cases) {
    it(`${name} puts the row back and shows the error`, async () => {
      const view = await mount();
      await fireEvent.press(screen.getByLabelText(label));
      expect(screen.getByText(username)).toBeTruthy();
      await waitFor(() => expect(shown).toContainEqual(expect.objectContaining({ type: 'game_error' })));
      await view.unmount();
    });
  }

  it('remove puts the friend back and shows the error', async () => {
    const view = await mount();
    await fireEvent.press(screen.getByLabelText(/remove besi/i));
    await fireEvent.press(screen.getByTestId('confirm-accept'));
    expect(screen.getByText('Besi')).toBeTruthy();
    await waitFor(() => expect(shown).toContainEqual(expect.objectContaining({ type: 'game_error' })));
    await view.unmount();
  });
});

describe('the pending section tells a failed load from an empty one', () => {
  it('shows an error with retry, not "nothing pending"', async () => {
    const view = await mount(['/api/friends/requests']);
    expect(await screen.findByLabelText(/try loading your pending requests again/i)).toBeTruthy();
    expect(screen.queryByText(/nothing pending/i)).toBeNull();
    await view.unmount();
  });

  it("is not stale when the failing list never loaded, whatever the other list holds", async () => {
    const view = await mount(['/api/friends/requests'], { ...SEED, '/api/friends/sent': [] });
    expect(await screen.findByLabelText(/try loading your pending requests again/i)).toBeTruthy();
    expect(screen.queryByText("Couldn't refresh")).toBeNull();
    await view.unmount();
  });
});
