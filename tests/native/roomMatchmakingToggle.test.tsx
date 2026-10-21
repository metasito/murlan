// tests/native/roomMatchmakingToggle.test.tsx — the room screen's two host
// switches: the one that opens the room to strangers, and the one that fills
// it with bots.
//
// A source scan cannot tell a rendered control from a defined one, and the
// whole point of both is what they emit, so this renders the screen.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, act } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderApp } from './harness/renderApp';
import { room } from './harness/wire';
import { route } from './mocks/http';

import { en as locale } from '@/locales/en';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));

const roomModule = require('@/app/(online)/room') as {
  default: React.ComponentType;
  BOTS_OFFERED_AFTER_MS: number;
};
const RoomScreen = roomModule.default;
const { BOTS_OFFERED_AFTER_MS } = roomModule;
const COUNTDOWN_STEP_MS = 1_000;


const MATCHMAKING = locale['room.fillWithMatchmakingA11yLabel'];
const BOTS = locale['room.fillWithBotsA11yLabel'];

async function renderRoom(visibility: 'public' | 'private' = 'private') {
  route('GET', '/api/friends', { body: [] });
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(<RoomScreen />, { user: { id: 'host', username: 'Ana' }, online: true, connected: true });
  await view.socket().deliver('room:state', room({ code: 'ABCDEF', hostUserId: 'host', visibility }));
  view.socket().reset();
  return view;
}

describe('the room screen matchmaking toggle', () => {
  it('reads off the room rather than off a local copy of it', async () => {
    const closed = await renderRoom();
    expect(closed.getByRole('switch', { name: MATCHMAKING, checked: false })).toBeTruthy();
    await closed.unmount();

    const open = await renderRoom('public');
    expect(open.getByRole('switch', { name: MATCHMAKING, checked: true })).toBeTruthy();
    await open.unmount();
  });

  it('asks the server to open the room, and to close it again', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByRole('switch', { name: MATCHMAKING }));
    expect(view.socket().sentAs('room:setVisibility')).toEqual([expect.objectContaining({ visibility: 'public' })]);
    await view.unmount();

    const opened = await renderRoom('public');
    await fireEvent.press(opened.getByRole('switch', { name: MATCHMAKING }));
    expect(opened.socket().sentAs('room:setVisibility')).toEqual([expect.objectContaining({ visibility: 'private' })]);
    await opened.unmount();
  });

  it('says when bots will be offered, so the wait reads as finite', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderRoom();
      const hint = (seconds: number) =>
        locale['room.botsComingIn'].replace('{{seconds}}', String(seconds));

      await act(async () => {
        jest.advanceTimersByTime(COUNTDOWN_STEP_MS);
      });
      expect(view.getByText(hint(29))).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(BOTS_OFFERED_AFTER_MS - COUNTDOWN_STEP_MS);
      });
      expect(view.queryByText(hint(0))).toBeNull();
      expect(view.getByRole('switch', { name: BOTS })).toBeTruthy();

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not offer bots until the host has actually been kept waiting', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderRoom();
      expect(view.queryByRole('switch', { name: BOTS })).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(BOTS_OFFERED_AFTER_MS - 1);
      });
      expect(view.queryByRole('switch', { name: BOTS })).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(view.getByRole('switch', { name: BOTS, checked: false })).toBeTruthy();

      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
