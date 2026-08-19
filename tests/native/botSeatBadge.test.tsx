// tests/native/botSeatBadge.test.tsx — the persistent bot-seat marker (UX-13).
//
// `game:seat_bot_takeover` already puts up a 4-second NotificationBanner when a
// seat is vacated (see context/OnlineGameContext.tsx), but that timer has
// nothing to do with the seat's actual, ongoing state. This checks the seat
// slots directly, from `player.type` alone, with no notification in play and
// no timer elapsed — the one thing the banner cannot cover.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TopOppSlot, SideOppSlot } from '@/components/table/seats';
import type { Player } from '@/lib/gameEngine';
import { it as itLocale } from '@/locales/it';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const withSafeArea = (ui: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>
);

const seat = (type: Player['type']): Player => ({
  id: 'p1',
  name: 'Gent',
  hand: [],
  type,
});

const BOT_LABEL = itLocale['onlineGame.botSeatLabel'];

describe('the bot-seat marker is persistent, not a notification', () => {
  it('TopOppSlot marks an ai seat', async () => {
    const view = await render(
      withSafeArea(<TopOppSlot player={seat('ai')} isActive={false} cardCount={5} />)
    );
    expect(view.queryByText(BOT_LABEL)).toBeTruthy();
    await view.unmount();
  });

  it('TopOppSlot does not mark a human seat', async () => {
    const view = await render(
      withSafeArea(<TopOppSlot player={seat('human')} isActive={false} cardCount={5} />)
    );
    expect(view.queryByText(BOT_LABEL)).toBeNull();
    await view.unmount();
  });

  it('SideOppSlot marks an ai seat', async () => {
    const view = await render(
      withSafeArea(
        <SideOppSlot player={seat('ai')} isActive={false} side="left" cardCount={5} />
      )
    );
    expect(view.queryByText(BOT_LABEL)).toBeTruthy();
    await view.unmount();
  });

  it('SideOppSlot does not mark a human seat', async () => {
    const view = await render(
      withSafeArea(
        <SideOppSlot player={seat('human')} isActive={false} side="right" cardCount={5} />
      )
    );
    expect(view.queryByText(BOT_LABEL)).toBeNull();
    await view.unmount();
  });
});
