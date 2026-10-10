// tests/native/cardRectCommit.test.tsx — the writes a commit queues for a card leave it in the registry,
// with the values that commit set, once the UI thread has run them (#1259 plan 4, task 11).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React, { useLayoutEffect, useMemo } from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable, type SharedValue } from 'react-native-reanimated';

import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import { useCardRect, type CardTable } from '@/components/table/useCardRects';

// jest applies a JS-thread write at once; native queues it for the UI thread, which this store models.
function uiQueue() {
  const jobs: (() => void)[] = [];
  function mutable<T>(initial: T) {
    let now = initial;
    return {
      get value() {
        return now;
      },
      get: () => now,
      set: (v: T) => void jobs.push(() => (now = v)),
      modify: (fn: (v: T) => T) => void jobs.push(() => (now = fn(now))),
    } as unknown as SharedValue<T>;
  }
  return { mutable, run: () => jobs.splice(0).map((job) => job()).length };
}

const at = { x: 0, y: 0 };
const rect = (x: number): CardRect => ({ x, y: 0, w: 1, h: 1, rot: 0, back: false, lift: 0, glow: 0, seen: 1 });

function Owner({ table, arc, turn, tick, drawn }: { table: CardTable; arc: SharedValue<number>; turn: number; tick: number; drawn: boolean }) {
  useLayoutEffect(() => {
    arc.set(turn);
  }, [arc, turn]);
  useCardRect(table, 'hand:a', drawn, () => {
    'worklet';
    return rect(arc.value + tick * 0);
  });
  return null;
}

describe('a card rect under queued UI writes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a drawn card through a re-render and publishes the values its commit set', async () => {
    const ui = uiQueue();
    const rects = ui.mutable<CardRects>({});
    const arc = ui.mutable(1);
    const table: CardTable = {
      rects,
      felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at },
      motion: makeMutable(TABLE_AT_REST),
      pile: at,
      hand: at,
      seats: { top: at, left: at, right: at },
      handLift: makeMutable(0),
      glossLight: makeMutable({ lx: 0, ly: 0, level: 1, r: 1 }),
    };
    const Table = ({ turn, tick = 0, drawn }: { turn: number; tick?: number; drawn: boolean }) => <Owner table={useMemo(() => table, [])} arc={arc} turn={turn} tick={tick} drawn={drawn} />;

    const view = await render(<Table turn={1} drawn />);
    ui.run();
    expect(rects.get()['hand:a']?.x).toBe(1);

    await view.rerender(<Table turn={1} tick={1} drawn />);
    ui.run();
    expect(rects.get()['hand:a']?.x).toBe(1);

    await view.rerender(<Table turn={2} drawn />);
    expect(rects.get()['hand:a']?.x).toBe(1);
    ui.run();
    expect(rects.get()['hand:a']?.x).toBe(2);
    const was = rects.get();
    jest.advanceTimersByTime(50);
    expect(ui.run()).toBeGreaterThan(0);
    expect(rects.get()).toBe(was);

    await view.rerender(<Table turn={2} drawn={false} />);
    ui.run();
    expect(rects.get()).toEqual({});
    await view.unmount();
  });
});
