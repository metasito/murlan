// tests/native/exchangeReceivedNeverMissing.test.tsx — the winner's hand holds the received card
// back until its leg lands, so its flier is drawn on every frame from its first until then.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { LEG } from '@/lib/game/exchangeTimeline';
import { Motion } from '@/lib/tokens';
import { Legs, frames, trade } from './helpers/exchangeLegs';

describe('the received card, seen by the winner', () => {
  it('is drawn on every frame from its leg to its landing', async () => {
    jest.useFakeTimers();
    const onStage = jest.fn();
    const view = await render(<Legs trade={trade()} viewerSeat={0} onStage={onStage} />);
    const opacity = () => (getAnimatedStyle(view.getByTestId('exchange-flier-to-winner', { includeHiddenElements: true })) as { opacity: number }).opacity;
    const landed = () => onStage.mock.calls.some(([leg, s]) => leg === 'receive' && s === 'landed');
    await frames(Motion.exchange.beat + LEG.end + 160, (t) => {
      if (t > Motion.exchange.beat + 32 && !landed()) expect([t, opacity()]).toEqual([t, 1]);
    });
    expect(landed()).toBe(true);
    await view.unmount();
    jest.useRealTimers();
  });
});
