// tests/native/joinInviteFromHome.test.tsx — tapping Join on an invite seats
// the player, without asking again.
//
// The invite lives in `SocketContext`, above the whole app; `joinRoom` lives in
// `OnlineGameContext`, mounted inside the `(online)` group alone. So the tap
// records which room was asked for and the group performs it. What this pins is
// the half that silently stops working: that the group's router acts on an
// accepted invite, and that the hub does NOT re-open the join modal to ask for a
// code the player has already chosen (#398).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { setWindow } from './harness/env';
import { renderAppHook } from './harness/renderApp';
import { room } from './harness/wire';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useSegments: () => ['(online)'],
}));

import OnlineLobbyScreen from '@/app/(online)/index';
import { useInvites } from '@/context/SocketContext';

let accounts = 0;
/** The hub under the online group's routing, on an account of its own so its socket starts never connected. */
const mount = async ({ connected = true }: { connected?: boolean } = {}) => {
  await setWindow({ width: 390, height: 844 });
  const view = await renderAppHook(useInvites, {
    user: { id: `u${++accounts}`, username: 'me' },
    online: true,
    follow: true,
    connected,
    wrap: (probe) => (
      <>
        {probe}
        <OnlineLobbyScreen />
      </>
    ),
  });
  const joins = () => view.socket().sentAs('room:join').map((join) => join.code);
  return { ...view, joins };
};
type View = Awaited<ReturnType<typeof mount>>;
const accept = (r: View) => act(async () => r.result.current.accept('ABC123'));
const answerJoin = (r: View) =>
  act(async () => r.socket().acks.find((ack) => ack.event === 'room:join')!.answer({ ok: true }));

describe('an invite the player has already accepted', () => {
  it('joins that room without asking again', async () => {
    const r = await mount();
    await accept(r);

    expect(r.joins()).toEqual(['ABC123']);
    // The owner's requirement in as many words: no room-code screen on this
    // path. The modal's own title is the thing that must not be on screen.
    expect(screen.queryByText('Join a room')).toBeNull();

    await r.unmount();
  });

  it('consumes it once the join is answered, so a re-render cannot join twice', async () => {
    const r = await mount();
    await accept(r);
    await answerJoin(r);
    await r.rerender();

    expect(r.joins()).toEqual(['ABC123']);
    expect(r.result.current.accepted).toBeNull();

    await r.unmount();
  });

  it('waits for the socket rather than emitting into a closed one', async () => {
    // `joinRoom` is `socket?.emit`, which is a silent no-op before the socket
    // connects — the player would sit on an unchanged lobby forever.
    const r = await mount({ connected: false });
    await accept(r);

    expect(r.joins()).toEqual([]);
    expect(r.result.current.accepted).toBe('ABC123');

    await r.unmount();
  });

  it('says it is joining, so the wait is not a dead screen', async () => {
    const r = await mount({ connected: false });
    await accept(r);

    expect(screen.getByText('Joining the table…')).toBeTruthy();

    await r.unmount();
  });

  it('stops saying so once the room arrives', async () => {
    // The room is pushed *on top of* this screen rather than replacing it, so
    // this instance survives the join and is what back returns to.
    const r = await mount();
    await accept(r);
    await r.socket().deliver('room:state', room({ code: 'ABC123', hostUserId: 'host' }));
    await answerJoin(r);

    expect(screen.queryByText('Joining the table…')).toBeNull();

    await r.unmount();
  });
});

describe('an invite that merely arrived', () => {
  it('still asks, because nobody has answered it', async () => {
    const r = await mount();
    await r.socket().deliver('friend:invite', { from: 'ana', roomCode: 'ZZZ999' });

    // An invite turning up must never move anyone: it prefills and asks.
    expect(r.joins()).toEqual([]);
    expect(screen.getByText('Join a room')).toBeTruthy();

    await r.unmount();
  });
});

describe('an ordinary visit to the hub', () => {
  it('joins nothing and asks nothing', async () => {
    const r = await mount();

    expect(r.joins()).toEqual([]);
    expect(screen.queryByText('Join a room')).toBeNull();
    expect(screen.queryByText('Joining the table…')).toBeNull();

    await r.unmount();
  });
});
