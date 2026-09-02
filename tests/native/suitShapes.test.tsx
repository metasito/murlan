// tests/native/suitShapes.test.tsx — a suit is told apart by its own glyph
// (components/CardView.tsx `SuitDef`), not only by ink. tests/suitColours.test.ts
// pins the ink; its own comment says "the pip glyph differs per suit" and
// nothing asserted that sentence until now. Collapsing every suit to the same
// SVG shape — separated only by fill colour — passed the whole suite with 0
// failures before this.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => 'on',
}));

import { CardView } from '@/components/CardView';
import type { Card, Suit } from '@/lib/gameEngine';
// The instance type behind every RNTL query in this codebase's installed
// version — `test-renderer`'s own, not `react-test-renderer`'s.
import type { TestInstance } from 'test-renderer';

// The Ace draws exactly one pip in the centre, so the <Defs><SuitDef/></Defs>
// this reads is the whole of the suit's own shape — no other card draws more
// of it, only more copies. `queryAll` on the raw node, rather than a typed
// query, because `container` has no by-component-type query — an SVG Path is
// told apart from a Circle by which props it carries.
const isPath = (n: TestInstance) => typeof n.props.d === 'string';
const isCircle = (n: TestInstance) =>
  typeof n.props.r === 'number' && typeof n.props.cx === 'number' && typeof n.props.d !== 'string';

/** Ace of the given suit: the one card whose face draws exactly one pip. */
const ace = (suit: Suit): Card => ({ id: `A_${suit}`, rank: 'A', suit, isJoker: false });

/** The suit definition's own Path and Circle descendants, wherever the def
 *  actually lives in the tree — a G wrapper for clubs, a bare Path for the
 *  other three. */
async function suitDefShape(suit: Suit) {
  const r = await render(<CardView card={ace(suit)} scale={1} light="flat" />);
  const paths = r.container.queryAll(isPath).map((p) => p.props.d as string);
  const circles = r.container.queryAll(isCircle).length;
  await r.unmount();
  return { paths, circles };
}

describe('a suit is distinguishable by shape, not only by fill colour', () => {
  it('hearts, diamonds and spades each draw their own distinct outline', async () => {
    const hearts = await suitDefShape('hearts');
    const diamonds = await suitDefShape('diamonds');
    const spades = await suitDefShape('spades');

    // None of the three is a circle — the exact shape a hue-only regression
    // collapses every suit to.
    expect(hearts.circles).toBe(0);
    expect(diamonds.circles).toBe(0);
    expect(spades.circles).toBe(0);

    expect(hearts.paths[0]).not.toBe(diamonds.paths[0]);
    expect(hearts.paths[0]).not.toBe(spades.paths[0]);
    expect(diamonds.paths[0]).not.toBe(spades.paths[0]);
  });

  it('clubs is built from three circles and a path — a different construction, not just a different fill', async () => {
    const clubs = await suitDefShape('clubs');
    expect(clubs.circles).toBe(3);
    expect(clubs.paths.length).toBeGreaterThanOrEqual(1);
  });
});
