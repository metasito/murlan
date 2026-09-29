// tests/native/flightStartsOnce.test.tsx — jest runs without the React Compiler, so a throw that
// restarts on its parent's re-render shows here even when the compiled app hides it.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { FlyingCards } from '@/components/table/pile';
import { pileSlots } from '@/components/flightPose';
import { flightSpec, NO_LANDING } from '@/components/table/useFlightClock';
import type { Card } from '@/lib/game/gameEngine';

const CARDS: Card[] = [
  { id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card,
  { id: 'A_hearts', rank: 'A', suit: 'hearts', isJoker: false } as Card,
];
const FROM = CARDS.map((_, i) => ({ x: -40 + 80 * i, y: 160, rot: 0, scale: 1.4 }));
const TO = pileSlots(2, 60, 400);
const LANDING = { ...NO_LANDING, cards: 2 };

describe('a throw', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts its clock once, whatever its parent re-renders', async () => {
    const onStart = jest.fn();
    const signal = makeMutable(NO_LANDING);
    const spec = flightSpec('k1', FROM, TO, false, false);
    const tree = (n: number) => (
      <FlyingCards key="k1" cards={CARDS} flight={{ ...spec }} landing={{ ...LANDING }} signal={signal}
        onStart={(...a) => onStart(n, ...a)} onEnd={() => {}} scale={1} />
    );
    const view = await render(tree(0));
    for (let r = 1; r <= 3; r++) {
      await act(async () => { jest.advanceTimersByTime(16); });
      await view.rerender(tree(r));
    }
    await act(async () => { jest.advanceTimersByTime(16 * 40); });
    expect(onStart).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
