// tests/native/notifyOnlyConsumer.test.tsx — a banner coming and going must not
// re-render a component that only raises them.
import { describe, it, expect } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render } from '@testing-library/react-native';

import { NotificationProvider, useBanner, useNotification } from '@/context/NotificationContext';

const seen: {
  notifierRenders: number;
  commands?: ReturnType<typeof useNotification>;
  banner?: ReturnType<typeof useBanner>;
} = { notifierRenders: 0 };

function Notifier() {
  const value = useNotification();
  useEffect(() => {
    seen.commands = value;
    seen.notifierRenders += 1;
  });
  return null;
}

function BannerReader() {
  const value = useBanner();
  useEffect(() => {
    seen.banner = value;
  });
  return null;
}

const commands = () => seen.commands!;
const banner = () => seen.banner!;

describe('the notification context', () => {
  it('does not re-render a notify-only consumer when the banner changes', async () => {
    seen.notifierRenders = 0;
    await render(
      <NotificationProvider>
        <Notifier />
        <BannerReader />
      </NotificationProvider>
    );
    const first = commands();
    const rendersAtRest = seen.notifierRenders;

    await act(async () => commands().showNotification({ type: 'game_info', title: 'A', message: 'one' }));
    expect(banner().notification?.message).toBe('one');
    await act(async () => banner().reportBannerBottom(80));
    await act(async () => commands().notifyError('two'));
    await act(async () => banner().dismissNotification());
    await act(async () => banner().dismissNotification());

    expect(banner().notification).toBeNull();
    expect(seen.notifierRenders).toBe(rendersAtRest);
    expect(commands()).toBe(first);
  });
});
