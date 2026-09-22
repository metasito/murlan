import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import type { Card, Rank } from '@/lib/game/gameEngine';

const mockHops = { n: 0 };
jest.mock('react-native-worklets', () => {
  const actual = jest.requireActual('react-native-worklets') as Record<string, unknown>;
  return {
    ...actual,
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      mockHops.n += 1;
      fn(...args);
    },
  };
});

type Handler = (e: unknown, state: unknown) => void;
const mockGesture: { current: { handlers: Record<string, Handler> } | null } = { current: null };
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler') as Record<string, unknown>;
  return {
    ...actual,
    GestureDetector: ({ gesture, children }: { gesture: never; children: React.ReactNode }) => {
      mockGesture.current = gesture;
      return children;
    },
  };
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

const { StraightHand } = require('@/components/table/hand') as typeof import('@/components/table/hand');

const RANKS: Rank[] = ['3', '4', '5'];
const cards: Card[] = RANKS.map((rank) => ({ id: `${rank}_spades`, suit: 'spades', rank, isJoker: false }));
const touch = (x: number) => ({ allTouches: [{ x, y: 10 }] });
const state = { activate: () => {}, fail: () => {}, end: () => {}, begin: () => {} };

describe('a finger scrolling the hand stops the hold clock once', () => {
  it('hops to JS for the first horizontal move only', async () => {
    const view = await render(
      <StraightHand
        cards={cards}
        selectedIds={[]}
        onPress={() => {}}
        onReorder={() => {}}
        disabled={false}
        availW={600}
        roomW={456}
      />
    );
    const h = mockGesture.current!.handlers;
    h.onTouchesDown(touch(100), state);
    const afterDown = mockHops.n;
    expect(afterDown).toBeGreaterThan(0);
    for (const x of [110, 120, 130, 140]) h.onTouchesMove(touch(x), state);
    expect(mockHops.n - afterDown).toBe(1);
    await view.unmount();
  });
});
