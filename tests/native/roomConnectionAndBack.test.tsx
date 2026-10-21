// tests/native/roomConnectionAndBack.test.tsx — the waiting room while the
// socket is down, and every way off it. Start and the visibility switch send
// intents, so neither is live without a connection, and the screen says why.
// Back by any route asks the same question as the header's back button; the
// guard steps aside once the room is gone or a game exists, since the router
// replaces away from the room then and a held guard would trap the player.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { BackHandler, Platform } from 'react-native';
import { fireEvent, act, screen } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { state } from '../support/game';
import { renderApp } from './harness/renderApp';
import { room, wire } from './harness/wire';
import { route } from './mocks/http';

import { en as locale } from '@/locales/en';

type Prevented = { data: { action: { type: string } } };
const mockGuard: { prevent: boolean | null; onPrevented: ((e: Prevented) => void) | null } = {
  prevent: null,
  onPrevented: null,
};
const POP: Prevented = { data: { action: { type: 'POP' } } };

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, onPrevented: (e: Prevented) => void) => {
    mockGuard.prevent = prevent;
    mockGuard.onPrevented = onPrevented;
  },
}));

const mockBrowserBack: { active: boolean | null; onBack: (() => void) | null } = { active: null, onBack: null };
jest.mock('@/lib/browserBack', () => ({
  useBrowserBackGuard: (active: boolean, onBack: () => void) => {
    mockBrowserBack.active = active;
    mockBrowserBack.onBack = onBack;
  },
}));

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;


const START = locale['room.startGame'];
const MATCHMAKING = locale['room.fillWithMatchmakingA11yLabel'];

let accounts = 0;
/** The host of a two-seat lobby, on an account of its own so its socket starts never connected. */
const mount = async ({ connected = true }: { connected?: boolean } = {}) => {
  const host = `host${++accounts}`;
  route('GET', '/api/friends', { body: [] });
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(<RoomScreen />, { user: { id: host, username: 'Ana' }, online: true, connected });
  await view.socket().deliver(
    'room:state',
    room({
      code: 'ABCDEF',
      hostUserId: host,
      players: [
        { seatIndex: 0, userId: host, username: 'Ana' },
        { seatIndex: 1, userId: 'b', username: 'Besi' },
      ],
    })
  );
  return view;
};
type View = Awaited<ReturnType<typeof mount>>;
const left = (view: View) => view.socket().sentAs('room:leave').length;
/** The server telling the player their room is gone. */
const goneAway = (view: View) =>
  view.socket().deliver('game:rejoin_failed', { code: 'ROOM_NOT_FOUND', message: 'That room has closed.' });

beforeEach(() => {
  mockGuard.prevent = null;
  mockGuard.onPrevented = null;
  mockBrowserBack.active = null;
  mockBrowserBack.onBack = null;
});

describe('the waiting room without a connection', () => {
  it('says it is connecting and holds Start and the visibility switch', async () => {
    const view = await mount({ connected: false });

    expect(screen.getByText(locale['onlineLobby.connecting'])).toBeTruthy();
    expect(screen.getByRole('button', { name: START })).toBeDisabled();
    expect(screen.getByRole('switch', { name: MATCHMAKING })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: START }));
    expect(view.socket().sentAs('room:start')).toEqual([]);
    await view.unmount();
  });

  it('frees both once connected', async () => {
    const view = await mount();

    expect(screen.queryByText(locale['onlineLobby.connecting'])).toBeNull();
    expect(screen.getByRole('button', { name: START })).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: MATCHMAKING })).not.toBeDisabled();
    await view.unmount();
  });
});

describe('back on the waiting room', () => {
  it('asks the leave question, and leaves only on confirm', async () => {
    const view = await mount();
    expect(mockGuard.prevent).toBe(true);

    await act(async () => mockGuard.onPrevented!(POP));
    await fireEvent.press(screen.getByLabelText(locale['common.cancel']));
    expect(left(view)).toBe(0);

    await act(async () => mockGuard.onPrevented!(POP));
    await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
    expect(left(view)).toBe(1);
    await view.unmount();
  });

  it("answers the browser's back with the same question, under the same guard", async () => {
    const view = await mount();
    expect(mockBrowserBack.active).toBe(true);

    await act(async () => mockBrowserBack.onBack!());
    await fireEvent.press(screen.getByLabelText(locale['common.cancel']));
    expect(left(view)).toBe(0);

    await act(async () => mockBrowserBack.onBack!());
    await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
    expect(left(view)).toBe(1);
    await view.unmount();
  });

  it('lets the router replace the room once a game exists or the room is gone', async () => {
    const dealt = await mount();
    await dealt.socket().deliver('game:state', wire(state(), 0), () => {});
    expect(mockGuard.prevent).toBe(false);
    expect(mockBrowserBack.active).toBe(false);
    await dealt.unmount();

    const gone = await mount();
    expect(mockGuard.prevent).toBe(true);
    await goneAway(gone);
    expect(mockGuard.prevent).toBe(false);
    expect(mockBrowserBack.active).toBe(false);
    await gone.unmount();
  });

  it('answers the Android back button with the same question', async () => {
    const listeners: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      listeners.push(handler);
      return {
        remove: () => {
          listeners.splice(listeners.indexOf(handler), 1);
        },
      };
    });
    try {
      const view = await mount();
      if (Platform.OS !== 'android') {
        expect(listeners).toHaveLength(0);
        await view.unmount();
        return;
      }
      expect(listeners).toHaveLength(1);
      let handled: boolean | null | undefined;
      await act(async () => {
        handled = listeners[0]({ type: 'hardwareBackPress', timeStamp: 0 });
      });
      expect(handled).toBe(true);
      await fireEvent.press(screen.getByLabelText(locale['room.leaveConfirmConfirm']));
      expect(left(view)).toBe(1);

      await goneAway(view);
      expect(listeners).toHaveLength(0);
      await view.unmount();
    } finally {
      spy.mockRestore();
    }
  });
});
