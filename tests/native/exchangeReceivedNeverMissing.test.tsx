// tests/native/exchangeReceivedNeverMissing.test.tsx — the winner's hand holds the received card
// back until both legs land, so its flier stays drawn from its first frame until then.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { ExchangeLegs } from '@/components/table/ExchangeLegs';
import type { Card } from '@/lib/game/gameEngine';
import { GIVE_MS, RECEIVE_LEAD, restPoint, type LegPoints } from '@/lib/game/exchangeTimeline';

const FAN = { x: 0, y: -120, rot: 0, scale: 0.4 };
const HAND = { x: 0, y: 120, rot: 0, scale: 1.2 };
const RECEIVE: LegPoints = { from: FAN, fromFace: false, rest: restPoint(HAND), to: HAND, toFace: true };
const GIVE: LegPoints = { from: HAND, fromFace: true, rest: restPoint(FAN), to: FAN, toFace: false };
const card = (id: string, rank: Card['rank']): Card => ({ id, suit: 'clubs', rank, isJoker: false });

describe('the received card, seen by the winner', () => {
  it('is drawn on every frame from its leg to the legs landing', async () => {
    jest.useFakeTimers();
    const onLanded = jest.fn();
    const view = await render(
      <ExchangeLegs
        data={{ winnerName: 'Ana', loserName: 'Bea', winnerIdx: 0, loserIdx: 1, bothJokersException: false, cardReceived: card('2_clubs', '2'), cardGiven: card('5_clubs', '5') }}
        legs={{ receive: RECEIVE, give: GIVE }}
        viewerSeat={0}
        scale={1}
        onLanded={onLanded}
        onDismiss={() => {}}
      />
    );
    const opacity = () => (getAnimatedStyle(view.getByTestId('exchange-flier-to-winner')) as { opacity: number }).opacity;
    for (let t = 16; onLanded.mock.calls.length === 0 && t < GIVE_MS + 160; t += 16) {
      await act(async () => jest.advanceTimersByTime(16));
      if (t > RECEIVE_LEAD + 32 && onLanded.mock.calls.length === 0) expect([t, opacity()]).toEqual([t, 1]);
    }
    expect(onLanded).toHaveBeenCalledTimes(1);
    await view.unmount();
    jest.useRealTimers();
  });
});
