// tests/native/exchangeReceivedNeverMissing.test.tsx — a traded card is drawn exactly once on every
// frame: by the hand until its flier shows, by the flier until the hand has drawn it back.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';
import { LEG } from '@/lib/game/exchangeTimeline';
import { Motion } from '@/lib/tokens';
import { Legs, frames, trade } from './helpers/exchangeLegs';

const LANDS = Motion.exchange.beat + LEG.end;

async function legs(props: Omit<React.ComponentProps<typeof Legs>, 'trade' | 'onStage'>) {
  const onStage = jest.fn();
  const view = await render(<Legs trade={trade()} onStage={onStage} {...props} />);
  const opacity = () => (getAnimatedStyle(view.getByTestId('exchange-flier-to-winner', { includeHiddenElements: true })) as { opacity: number }).opacity;
  const landed = () => onStage.mock.calls.some(([leg, s]) => leg === 'receive' && s === 'landed');
  return { view, opacity, landed };
}

describe('the received card, seen by the winner', () => {
  it('is drawn on every frame from its leg to its landing, and gone once the hand has it', async () => {
    jest.useFakeTimers();
    const { view, opacity, landed } = await legs({ viewerSeat: 0 });
    await frames(LANDS + 160, (t) => {
      if (t > Motion.exchange.beat + 32 && !landed()) expect([t, opacity()]).toEqual([t, 1]);
    });
    expect(landed()).toBe(true);
    expect(opacity()).toBe(0);
    await view.unmount();
    jest.useRealTimers();
  });

  it('stays on its last pose past its landing until the hand has drawn it', async () => {
    jest.useFakeTimers();
    const { view, opacity } = await legs({ viewerSeat: 0, handCommits: false });
    await frames(LANDS + 160, (t) => {
      if (t > Motion.exchange.beat + 32) expect([t, opacity()]).toEqual([t, 1]);
    });
    await view.unmount();
    jest.useRealTimers();
  });
});

describe('the given card, seen by the loser', () => {
  it('leaves the hand on the frame its flier first shows, and not before', async () => {
    jest.useFakeTimers();
    const lifted = makeMutable<string[]>([]);
    const { view, opacity, landed } = await legs({ viewerSeat: 1, lifted });
    let shown = 0;
    await frames(LANDS + 160, (t) => {
      if (landed()) return;
      if (opacity() === 1) shown++;
      expect([t, lifted.value]).toEqual([t, opacity() === 1 ? [trade().cardReceived!.id] : []]);
    });
    expect(shown).toBeGreaterThan(0);
    await view.unmount();
    expect(lifted.value).toEqual([]);
    jest.useRealTimers();
  });
});
