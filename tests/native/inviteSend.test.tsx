// tests/native/inviteSend.test.tsx — `useInvites().send` is the one way a
// screen invites a friend. A refusal is told once, by the `friend:error` the
// server sends with it; only silence is this hook's to tell, as a request that
// never arrived.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { act } from '@testing-library/react-native';

import { en as locale } from '@/locales/en';

import { INTENT_ACK_TIMEOUT_MS } from '@/lib/sendIntent';
import type { IntentReply } from '@/shared/protocol';
import { useInvites } from '@/context/SocketContext';
import { bannerLog } from './harness/bannerLog';
import { renderApp } from './harness/renderApp';
import { lastSocket } from './mocks/socketIo';

const { shown, BannerLog } = bannerLog();
const result = {} as { current: ReturnType<typeof useInvites> };
function Capture() {
  const invites = useInvites();
  useEffect(() => {
    result.current = invites;
  });
  return <BannerLog />;
}

const mount = async () => {
  const view = await renderApp(<Capture />, { user: { id: 'u1', username: 'Ana' } });
  return { result, unmount: view.unmount };
};

/** `silence` lets the ack's own timer run out. */
async function sendAnswered(answer: IntentReply | undefined | 'silence') {
  jest.useFakeTimers();
  const { result, unmount } = await mount();
  let sent: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    sent = result.current.send('f1', 'ABC123');
  });
  const [ack] = lastSocket().acks;
  expect(ack.event).toBe('friend:invite');
  expect(ack.payload).toEqual(expect.objectContaining({ friendUserId: 'f1', roomCode: 'ABC123' }));
  await act(async () => {
    if (answer === 'silence') return void jest.advanceTimersByTime(INTENT_ACK_TIMEOUT_MS);
    // As the server does: a refusal is acked and announced as `friend:error`.
    if (answer && !answer.ok) lastSocket().serverEmit('friend:error', { code: answer.code, message: 'refused' });
    ack.answer(answer);
  });
  const outcome = await sent;
  await unmount();
  return outcome;
}

beforeEach(() => {
  shown.length = 0;
});

describe('sending an invite', () => {
  it('reports success and says nothing more', async () => {
    expect(await sendAnswered({ ok: true, code: 'INVITE_SHOWN' })).toBe(true);
    expect(shown).toEqual([]);
  });

  it('tells the player the server refused, in its words, once', async () => {
    expect(await sendAnswered({ ok: false, code: 'NOT_FRIENDS' })).toBe(false);
    expect(shown).toHaveLength(1);
    expect(shown).toContainEqual(
      expect.objectContaining({ type: 'game_error', message: locale['server.NOT_FRIENDS'] })
    );
  });

  it('counts an ack with no reply as heard, as every intent does', async () => {
    expect(await sendAnswered(undefined)).toBe(true);
    expect(shown).toEqual([]);
  });

  it('tells the player the invite never arrived', async () => {
    expect(await sendAnswered('silence')).toBe(false);
    expect(shown).toHaveLength(1);
    expect(shown).toContainEqual(
      expect.objectContaining({ type: 'game_error', message: locale['room.requestNotDelivered'] })
    );
  });
});
