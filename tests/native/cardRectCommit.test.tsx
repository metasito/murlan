// tests/native/cardRectCommit.test.tsx — a card's rect is written and cleared in the commit that draws or hides it (#1259 plan 4, task 11).
import { describe, it, expect } from '@jest/globals';
import React, { useCallback, useLayoutEffect, useMemo } from 'react';
import { render } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import { TABLE_AT_REST, type CardRect, type DrawnCard } from '@/components/table/cardRects';
import { useCardRect, useCardTableValue, useStaticCardRects, type CardTable } from '@/components/table/useCardRects';

const at = { x: 0, y: 0 };
const PLACES = { pile: at, hand: at, seats: { top: at, left: at, right: at }, felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at } };
const rect = (x: number): CardRect => ({ x, y: 0, w: 1, h: 1, rot: 0, back: false, lift: 0, glow: 0, seen: 1 });

function Owner({ table, drawn, x }: { table: CardTable; drawn: boolean; x: number }) {
  const read = useCallback(() => {
    'worklet';
    return rect(x);
  }, [x]);
  useCardRect(table, 'hand:a', drawn, read);
  const fan = useMemo<DrawnCard[]>(() => (drawn ? [{ cx: x, cy: 0, w: 1, h: 1, rot: 0, back: true, lift: 0, glow: 0 }] : []), [drawn, x]);
  useStaticCardRects(table, 'fan:top:', fan);
  return null;
}

function Probe({ table, log }: { table: CardTable; log: (number | null)[][] }) {
  useLayoutEffect(() => {
    const r = table.rects.get();
    log.push([r['hand:a']?.x ?? null, r['fan:top:0']?.x ?? null]);
  });
  return null;
}

function Harness({ drawn, x, log }: { drawn: boolean; x: number; log: (number | null)[][] }) {
  const motion = useSharedValue(TABLE_AT_REST);
  const lift = useSharedValue(0);
  const table = useCardTableValue(PLACES, motion, lift);
  return (
    <>
      <Owner table={table} drawn={drawn} x={x} />
      <Probe table={table} log={log} />
    </>
  );
}

describe('a card rect follows the commit', () => {
  it('is in the registry when a later layout effect of the same commit reads it', async () => {
    const log: (number | null)[][] = [];
    const view = await render(<Harness drawn x={3} log={log} />);
    expect(log.at(-1)).toEqual([3, 3]);
    await view.rerender(<Harness drawn x={5} log={log} />);
    expect(log.at(-1)).toEqual([5, 5]);
    await view.rerender(<Harness drawn={false} x={5} log={log} />);
    expect(log.at(-1)).toEqual([null, null]);
    await view.unmount();
  });
});
