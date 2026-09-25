// tests/native/landWobble.test.tsx — under reduced motion `FlyingCards` holds the wobble's `k` at 0,
// where `landWobble` is at rest, so a player who asked for less motion gets no wobble.
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { FlyingCards } from '@/components/table/pile';
import { setMotionPreference } from '@/lib/accessibility';
import type { Card } from '@/lib/game/gameEngine';

const CARDS: Card[] = [{ id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card];

function flattenTransform(style: unknown): Record<string, unknown>[] {
  const flat: Record<string, unknown> = Object.assign(
    {},
    ...(Array.isArray(style) ? style.filter(Boolean) : [style])
  );
  return Array.isArray(flat.transform) ? (flat.transform as Record<string, unknown>[]) : [];
}

describe('a landed combination under reduced motion does not wobble', () => {
  afterEach(() => setMotionPreference('system'));

  it('the flying cards render the wobble scale, and it is exactly 1', async () => {
    setMotionPreference('on');
    const r = await render(
      <FlyingCards
        cards={CARDS}
        direction="top"
        origin={{ dx: 0, dy: -100 }}
        onDone={() => {}}
        roomW={400}
        scale={1}
      />
    );

    const transform = flattenTransform(r.getByTestId('flying-cards').props.style);
    const scales = transform.filter((t) => 'scale' in t);
    expect(scales).toEqual([{ scale: 1 }]);
    expect(transform.filter((t) => 'scaleX' in t || 'scaleY' in t)).toEqual([]);

    await r.unmount();
  });
});
