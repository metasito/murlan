// tests/native/landWobble.test.tsx — under reduced motion a play's group holds the wobble's `k` at 0,
// where `landWobble` is at rest, so a player who asked for less motion gets no wobble.
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { setMotionPreference } from '@/lib/accessibility';
import type { Card } from '@/lib/game/gameEngine';
import { flightOf, pileOf } from './helpers/landing';

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
    const flight = flightOf('k', CARDS, [{ x: 0, y: -100, rot: 0, scale: 0.4 }], true);
    const r = await render(pileOf({ plays: [flight], flights: [flight] }));

    const transform = flattenTransform(r.getByTestId('flying-cards', { includeHiddenElements: true }).props.style);
    const scales = transform.filter((t) => 'scale' in t);
    expect(scales).toEqual([{ scale: 1 }]);
    expect(transform.filter((t) => 'scaleX' in t || 'scaleY' in t)).toEqual([]);

    await r.unmount();
  });
});
