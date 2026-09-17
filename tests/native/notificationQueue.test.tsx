// tests/native/notificationQueue.test.tsx — a flaky link must not stack banners.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';

import {
  NOTIFICATION_QUEUE_MAX,
  NotificationProvider,
  useNotification,
  type NotificationData,
} from '@/context/NotificationContext';

let ctx: ReturnType<typeof useNotification>;
function Probe() {
  ctx = useNotification();
  return null;
}

const note = (message: string): NotificationData => ({ type: 'connection', title: 'Link', message });

async function drain(): Promise<string[]> {
  const seen: string[] = [];
  while (ctx.notification) {
    seen.push(ctx.notification.message);
    await act(async () => ctx.dismissNotification());
  }
  return seen;
}

describe('the notification queue', () => {
  it('drops a notification identical to one already queued', async () => {
    const view = await render(<NotificationProvider><Probe /></NotificationProvider>);
    await act(async () => {
      ctx.showNotification(note('not delivered'));
      ctx.showNotification(note('not delivered'));
      ctx.showNotification(note('other'));
      ctx.showNotification(note('not delivered'));
    });
    expect(await drain()).toEqual(['not delivered', 'other']);
    await view.unmount();
  });

  it('keeps the banner on screen and the newest behind it once full', async () => {
    const view = await render(<NotificationProvider><Probe /></NotificationProvider>);
    const sent = Array.from({ length: NOTIFICATION_QUEUE_MAX + 4 }, (_, i) => `m${i}`);
    await act(async () => sent.forEach((m) => ctx.showNotification(note(m))));
    expect(await drain()).toEqual([sent[0], ...sent.slice(sent.length - NOTIFICATION_QUEUE_MAX + 1)]);
    await view.unmount();
  });
});
