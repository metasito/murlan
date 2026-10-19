import { describe, it, expect, jest, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { Card, Rank } from '@/lib/game/gameEngine';
import { gesturesOf, stillSelection, storeOf } from './tapHelpers';

const mockGesture: { current: Parameters<typeof gesturesOf>[0] | null } = { current: null };
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler') as Record<string, unknown>;
  return {
    ...actual,
    GestureStateManager: { activate: () => {} },
    GestureDetector: ({ gesture, children }: { gesture: never; children: React.ReactNode }) => {
      mockGesture.current = gesture;
      return children;
    },
  };
});

const { StraightHand } = require('@/components/table/hand') as typeof import('@/components/table/hand');

const RANKS: Rank[] = ['3', '4', '5'];
const cards: Card[] = RANKS.map((rank) => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false }));
const touch = (x: number) => ({ handlerTag: 1, allTouches: [{ x, y: 10 }] });

async function advance(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
  }
}

describe('a card dropped into its slot', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  async function dropAndThen(afterDrop: (view: Awaited<ReturnType<typeof render>>) => Promise<void>) {
    jest.useFakeTimers();
    const onReorder = jest.fn();
    const view = await render(
      <StraightHand
        cards={cards}
        store={storeOf()}
        selection={stillSelection()}
        onActivate={() => {}}
        onReorder={onReorder}
        disabled={false}
        availW={600}
        roomW={456}
      />
    );
    const h = gesturesOf(mockGesture.current!).pan.config as Record<string, (e: unknown) => void>;
    await act(async () => {
      h.onTouchesDown(touch(100));
    });
    await advance(600);
    await act(async () => {
      h.onTouchesMove(touch(140));
    });
    await advance(48);
    await act(async () => {
      h.onUpdate({ x: 300, y: 10 });
    });
    await advance(48);
    await act(async () => {
      h.onDeactivate({});
    });
    await afterDrop(view);
    return onReorder;
  }

  it('reorders once the flight has finished', async () => {
    const onReorder = await dropAndThen(async () => {
      await advance(1500);
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it('never reorders a hand that unmounted mid-flight', async () => {
    const onReorder = await dropAndThen(async (view) => {
      await advance(32);
      await view.unmount();
      await advance(1500);
    });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
