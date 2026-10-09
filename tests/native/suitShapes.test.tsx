// tests/native/suitShapes.test.tsx — a suit is told apart by its own glyph
// (components/cardFaceModel.ts `SUIT_GLYPHS`), not only by ink. tests/ui-rules/suitColours.test.ts
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
import { SUIT_GLYPHS } from '@/components/cardFaceModel';
import type { Card, Rank, Suit } from '@/lib/game/gameEngine';
// The instance type behind every RNTL query in this codebase's installed
// version — `test-renderer`'s own, not `react-test-renderer`'s.
import type { TestInstance } from 'test-renderer';

const SUITS = ['hearts', 'diamonds', 'spades', 'clubs'] as const;
const isPath = (n: TestInstance) => typeof n.props.d === 'string';
const isUse = (n: TestInstance) => typeof n.props.href === 'string';
const subpaths = (d: string) => d.split('M').length - 1;

async function drawn(rank: Rank, suit: Suit) {
  const card: Card = { id: `${rank}_${suit}`, rank, suit, isJoker: false };
  const r = await render(<CardView card={card} scale={1} light="flat" />);
  const paths = r.container.queryAll(isPath).map((p) => p.props.d as string);
  const uses = r.container.queryAll(isUse).length;
  await r.unmount();
  return { paths, uses };
}

describe('a suit is distinguishable by shape, not only by fill colour', () => {
  it('each suit draws its own outline', async () => {
    const outlines: string[] = [];
    for (const suit of SUITS) outlines.push((await drawn('A', suit)).paths[0]);
    expect(new Set(outlines).size).toBe(SUITS.length);
  });

  it('clubs is three round lobes and a stem — a different construction, not just a different fill', () => {
    expect(subpaths(SUIT_GLYPHS.clubs)).toBe(4);
    expect(SUIT_GLYPHS.clubs.match(/A/g)).toHaveLength(6);
    for (const suit of ['hearts', 'diamonds', 'spades'] as const) expect(SUIT_GLYPHS[suit]).not.toMatch(/A/);
  });
});

// Android redraws a <Use> template at each reference, dispatching a layout event per mark per frame (#1222).
describe('every suit mark on a face is one path, drawn in place, never through <Use>', () => {
  it.each(SUITS)('ten of %s', async (suit) => {
    const { paths, uses } = await drawn('10', suit);
    expect(uses).toBe(0);
    expect(paths).toHaveLength(1);
    expect(subpaths(paths[0])).toBe(12 * subpaths(SUIT_GLYPHS[suit]));
  });
});
