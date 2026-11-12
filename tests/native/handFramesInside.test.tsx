// tests/native/handFramesInside.test.tsx — every hand view lies inside its parent's bounds, because UIKit
// hit-tests a touch only through views whose parent contains it: a card past its parent's edge is
// drawn and never tapped.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { getAnimatedStyle } from './harness/animatedStyle';
import type { Card } from '@/lib/game/gameEngine';
import { storeOf } from './tapHelpers';

const { StraightHand } = require('@/components/table/hand') as typeof import('@/components/table/hand');

const RANKS: Card['rank'][] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS: Card['suit'][] = ['spades', 'hearts', 'clubs'];
const hand = (n: number): Card[] =>
  Array.from({ length: n }, (_, i) => ({ rank: RANKS[i % 13], suit: SUITS[Math.floor(i / 13)] })).map((c) => ({ ...c, id: `${c.rank}_${c.suit}`, isJoker: false }));
const noop = () => {};

type Node = ReturnType<typeof screen.getByTestId>;
type Box = { left?: number; width?: number; overflow?: string; transform?: Record<string, number>[] };
const shiftOf = (s: Box | null | undefined) => (s?.transform ?? []).reduce((x, t) => x + (t.translateX ?? 0), 0);
/** A node's span on its parent's x axis: its left, its width, and the translation it is drawn at. */
const span = (n: Node) => {
  const s = StyleSheet.flatten(n.props.style) as Box;
  const x = (s.left ?? 0) + shiftOf(s) + shiftOf(getAnimatedStyle(n) as Box);
  return { x, w: s.width as number, clips: s.overflow === 'hidden' };
};
const inside = (outer: { w: number }, inner: { x: number; w: number }) => inner.x >= -1e-6 && inner.x + inner.w <= outer.w + 1e-6;

async function framesOf(n: number, availW: number) {
  const view = await render(
    <StraightHand cards={hand(n)} store={storeOf()} selection={{ shown: makeMutable<string[]>([]), tap: noop }}
      onActivate={noop} disabled={false} availW={availW} roomW={availW} />
  );
  await act(async () => void jest.advanceTimersByTime(1500));
  const [win, rest, pan, row] = ['hand-window', 'hand-rest', 'hand-pan', 'hand-row'].map((id) => span(screen.getByTestId(id)));
  const cards = screen.getAllByTestId(/^hand-card-/).map(span);
  await view.unmount();
  return { win, rest, pan, row, cards };
}

describe('the hand views', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['a short hand', 3],
    ['a full hand', 13],
  ])('hold %s inside each parent, the row inside the window', async (_, n) => {
    const { win, rest, pan, row, cards } = await framesOf(n, 600);
    expect(win.clips).toBe(false);
    expect(cards.filter((c) => !inside(row, c))).toEqual([]);
    expect([inside(pan, row), inside(rest, pan), inside(win, rest)]).toEqual([true, true, true]);
  });

  it('cover the window with the pan box when the row scrolls, every card still inside its parent', async () => {
    const { win, rest, pan, row, cards } = await framesOf(27, 300);
    expect(win.clips).toBe(true);
    expect(cards.filter((c) => !inside(row, c))).toEqual([]);
    expect([inside(pan, row), inside(rest, pan)]).toEqual([true, true]);
    const shown = { x: rest.x + pan.x, w: pan.w };
    expect(shown.x).toBeLessThanOrEqual(0);
    expect(shown.x + shown.w).toBeGreaterThanOrEqual(win.w);
  });
});
