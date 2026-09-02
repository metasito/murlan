// tests/native/landSquash.test.tsx — the squash-and-stretch on a card's
// landing (#731) is driven by the same `settle` shared value the pile's own
// overshoot spring (`Motion.spring.land`) already runs. Under reduced motion
// `FlyingCards` never advances `settle` past its initial 0 — that is the
// existing, already-pinned contract `landSquashScale(0)` answers with no
// deformation — so a player who asked for less motion gets none here either,
// with no second flag of its own to read.
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as any;
  return { ...actual, scheduleOnRN: () => {} };
});

import { FlyingCards } from '@/components/table/pile';
import { setMotionPreference } from '@/lib/accessibility';
import type { Card } from '@/lib/gameEngine';

const CARDS: Card[] = [{ id: 'A_clubs', rank: 'A', suit: 'clubs', isJoker: false } as Card];

function flattenTransform(style: unknown): Record<string, unknown>[] {
  const flat: Record<string, unknown> = Object.assign(
    {},
    ...(Array.isArray(style) ? style.filter(Boolean) : [style])
  );
  return Array.isArray(flat.transform) ? (flat.transform as Record<string, unknown>[]) : [];
}

describe('a landed card under reduced motion carries no deformation', () => {
  afterEach(() => setMotionPreference('system'));

  it('the flying card renders a scale transform, and it is exactly 1 on both axes', async () => {
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
    const scaleEntries = transform.filter((t) => 'scaleX' in t || 'scaleY' in t);
    // Pins that a scale transform actually exists — the squash this ticket
    // adds — rather than passing vacuously because none was ever wired up.
    expect(scaleEntries.length).toBeGreaterThan(0);
    for (const entry of scaleEntries) {
      if ('scaleX' in entry) expect(entry.scaleX).toBe(1);
      if ('scaleY' in entry) expect(entry.scaleY).toBe(1);
    }

    await r.unmount();
  });
});
