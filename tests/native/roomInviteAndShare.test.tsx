// tests/native/roomInviteAndShare.test.tsx — the room's invite panel marks an
// invite sent only when the server says so, and Share never fails silently.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { Platform, Share } from 'react-native';
import { fireEvent, act } from '@testing-library/react-native';
import { queriesSettled, renderApp } from './harness/renderApp';
import { setWindow } from './harness/env';
import { bannerLog } from './harness/bannerLog';
import { room } from './harness/wire';
import { httpRequests, route, unreachable, type HttpReply } from './mocks/http';

import { en as locale } from '@/locales/en';
import { it as itLocale } from '@/locales/it';
import { sq as sqLocale } from '@/locales/sq';

const { shown, BannerLog } = bannerLog();
const mockSetString = jest.fn(async (_s: string) => true);

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (s: string) => mockSetString(s),
}));

const RoomScreen = (require('@/app/(online)/room') as { default: React.ComponentType }).default;


const INVITE = locale['room.inviteA11yLabel'].replace('{{username}}', 'Besi');
const SENT = locale['room.inviteSentA11yLabel'].replace('{{username}}', 'Besi');

const BESI = [{ id: 'f1', username: 'Besi', lastSeen: null }];

/** The host alone in their lobby, with Besi online; `friends` answers the friends list once connected. */
async function renderRoom(friends: HttpReply | typeof unreachable | (() => Promise<HttpReply>) = { body: BESI }) {
  route('GET', '/api/friends', friends);
  await setWindow({ width: 390, height: 844 });
  const view = await renderApp(
    <>
      <BannerLog />
      <RoomScreen />
    </>,
    { user: { id: 'host', username: 'Ana' }, online: true, connected: true }
  );
  await view.socket().deliver('room:state', room({ code: 'ABCDEF', hostUserId: 'host' }));
  await view.socket().deliver('friend:online_list', { onlineIds: ['f1'] });
  return view;
}

const inviteAck = (view: Awaited<ReturnType<typeof renderRoom>>) =>
  view.socket().acks.filter((a) => a.event === 'friend:invite').at(-1)!;
const friendsAsked = () => httpRequests().filter((r) => r.method === 'GET' && r.path === '/api/friends').length;

beforeEach(() => {
  process.env.EXPO_PUBLIC_DOMAIN = 'murlan.example';
  shown.length = 0;
  mockSetString.mockClear();
});

describe('the invite panel waits for the server', () => {
  it('shows sent only once the server acknowledges ok', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(INVITE));
    expect(view.queryByLabelText(SENT)).toBeNull();
    await act(async () => inviteAck(view).answer({ ok: true }));
    expect(view.getByLabelText(SENT)).toBeTruthy();
    await view.unmount();
  });

  it('resets the row when the invite was not sent', async () => {
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(INVITE));
    await act(async () => inviteAck(view).answer({ ok: false, code: 'NEWER_SERVER_REFUSAL' }));
    expect(view.queryByLabelText(SENT)).toBeNull();
    expect(view.getByLabelText(INVITE)).toBeTruthy();
    await view.unmount();
  });

  it('says the friends list failed to load, with a retry', async () => {
    const view = await renderRoom(unreachable);
    await queriesSettled();
    const asked = friendsAsked();
    await fireEvent.press(view.getByLabelText(locale['friends.loadRetryA11yLabel']));
    expect(friendsAsked()).toBe(asked + 1);
    expect(view.queryByText(locale['room.noFriendsOnline'])).toBeNull();
    await view.unmount();
  });

  it('keeps the friends it has when a refresh fails, and only says it could not refresh', async () => {
    const view = await renderRoom();
    await queriesSettled();
    route('GET', '/api/friends', unreachable);
    await act(async () => view.socket().drop('transport close'));
    await act(async () => view.socket().open());
    await queriesSettled();
    expect(view.getByLabelText(INVITE)).toBeTruthy();
    expect(view.getByText(locale['common.refreshFailed'])).toBeTruthy();
    expect(view.queryByText(locale['friends.loadErrorTitle'])).toBeNull();
    await view.unmount();
  });

  it('says the friends list is loading rather than empty', async () => {
    let answer = (_reply: HttpReply) => {};
    const view = await renderRoom(() => new Promise<HttpReply>((resolve) => (answer = resolve)));
    expect(view.queryByText(locale['room.noFriendsOnline'])).toBeNull();
    expect(view.getAllByLabelText(locale['common.loading']).length).toBeGreaterThan(0);
    await act(async () => answer({ body: BESI }));
    await view.unmount();
  });
});

describe('share', () => {
  it('ignores a share the player dismissed', async () => {
    const spy = jest.spyOn(Share, 'share').mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(shown).toEqual([]);
    spy.mockRestore();
    await view.unmount();
  });

  it('reports a share that failed', async () => {
    const spy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('boom'));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(shown).toContainEqual(expect.objectContaining({ type: 'game_error', message: locale['room.shareFailed'] }));
    spy.mockRestore();
    await view.unmount();
  });

  it('shares the code and an https join link', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    const { message } = spy.mock.calls[0][0] as { message: string };
    expect(message).toContain('ABCDEF');
    expect(message).toContain('https://murlan.example/join/ABCDEF');
    expect(message).not.toContain('//join');
    spy.mockRestore();
    await view.unmount();
  });

  it('carries the code and the link in every locale', () => {
    for (const messages of [locale, itLocale, sqLocale]) {
      expect(messages['room.shareMessage']).toContain('{{code}}');
      expect(messages['room.shareMessage']).toContain('{{link}}');
    }
  });

  it('copies the invite on a web browser with no share sheet', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web');
    const spy = jest.spyOn(Share, 'share');
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['room.share']));
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetString).toHaveBeenCalledWith(expect.stringContaining('https://murlan.example/join/ABCDEF'));
    spy.mockRestore();
    os.restore();
    await view.unmount();
  });

  it('reports a copy that failed', async () => {
    mockSetString.mockRejectedValueOnce(new Error('denied'));
    const view = await renderRoom();
    await fireEvent.press(view.getByLabelText(locale['common.copy']));
    expect(shown).toContainEqual(expect.objectContaining({ type: 'game_error', message: locale['room.copyFailed'] }));
    await view.unmount();
  });
});
