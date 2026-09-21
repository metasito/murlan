// tests/native/flightShadow.test.tsx — a flying card carries a raised shadow
// that gives way at the moment it touches the felt (#1102).
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { FlyingCards } from '@/components/table/pile';
import { impactDelayMs, landingHoldMs } from '@/components/flightPhysics';
import { setMotionPreference } from '@/lib/accessibility';
import { Shadow } from '@/lib/theme';
import type { Card } from '@/lib/gameEngine';

const CARDS: Card[] = [
  { id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card,
  { id: 'A_hearts', rank: 'A', suit: 'hearts', isJoker: false } as Card,
];

function liftedOpacities(): number[] {
  return screen.getAllByTestId('flying-shadow-lifted').map(
    (node) => (getAnimatedStyle(node) as { opacity: number }).opacity
  );
}

describe('the flying card lands its shadow', () => {
  afterEach(() => {
    setMotionPreference('system');
    jest.useRealTimers();
  });

  it('holds the lifted shadow through the flight and drops it once the card is down', async () => {
    setMotionPreference('off');
    jest.useFakeTimers();
    const r = await render(
      <FlyingCards cards={CARDS} direction="top" origin={{ dx: 0, dy: -100 }} onDone={() => {}} roomW={400} scale={1} />
    );

    const style = Object.assign({}, ...[screen.getAllByTestId('flying-shadow-lifted')[0].props.style].flat(3).filter(Boolean));
    expect(style.boxShadow ?? style.shadowRadius).toBe(
      (Shadow.cardLifted as any).boxShadow ?? (Shadow.cardLifted as any).shadowRadius
    );
    expect(liftedOpacities()).toEqual([1, 1]);

    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) - 20);
    });
    expect(liftedOpacities()).toEqual([1, 1]);

    await act(async () => {
      jest.advanceTimersByTime(20 + landingHoldMs(false) + 20);
    });
    expect(liftedOpacities()).toEqual([0, 0]);

    await r.unmount();
  });
});
