// tests/native/cardGloss.test.tsx — every card view on the table carries the lamp's gloss, read from the
// registry and the lamp on the UI thread, so moving the lamp re-renders no card (#1260).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { getAnimatedStyle, makeMutable } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { TABLE_AT_REST, type CardRects } from '@/components/table/cardRects';
import { restingLamp } from '@/components/table/lampRig';
import { CardTableProvider, type CardTable } from '@/components/table/useCardRects';
import type { Card } from '@/lib/game/gameEngine';
import { frames } from './helpers/exchangeLegs';
import { throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const mockCardRenders = { n: 0 };
jest.mock('@/lib/cosmetics', () => {
  const actual = jest.requireActual('@/lib/cosmetics') as typeof import('@/lib/cosmetics');
  return {
    ...actual,
    useCardBackId: () => {
      mockCardRenders.n += 1;
      return actual.useCardBackId();
    },
  };
});

type Pose = { opacity?: number; transform?: Record<string, number | string>[] };
const pose = (n: TestInstance) => getAnimatedStyle(n as Parameters<typeof getAnimatedStyle>[0]) as Pose;
const glossIn = (n: TestInstance) => n.queryAll((c) => c.props.testID === 'card-gloss-spot')[0];

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the lamp gloss on the table', () => {
  it('lights a hand card, a seat back and a pile card from their own registry entries', async () => {
    const view = await throwPair(3);
    await frames(2000);
    const opts = { includeHiddenElements: true };
    const kinds = {
      hand: screen.queryAllByTestId(/^hand-card-/, opts)[0],
      seat: screen.queryAllByTestId('seat-back', opts)[0],
      pile: screen.queryAllByTestId('pile-card', opts)[0],
    };
    const lit = Object.fromEntries(Object.entries(kinds).map(([k, n]) => [k, n && glossIn(n) ? (pose(glossIn(n)).opacity ?? 0) > 0 : 'no gloss']));
    await view.unmount();
    expect(lit).toEqual({ hand: true, seat: true, pile: true });
  }, 120_000);
});

describe('moving the lamp', () => {
  it('moves every gloss and re-renders no card', async () => {
    const at = { x: 0, y: 0 };
    const lamp = makeMutable(restingLamp([437, 180, 1], 1));
    const rects = makeMutable<CardRects>({
      'hand:7_clubs': { x: 437, y: 330, w: 58, h: 84, rot: 0, back: false, lift: 0, glow: 0, seen: 1 },
      'fan:top:0': { x: 437, y: 40, w: 40, h: 58, rot: 0, back: true, lift: 0, glow: 0, seen: 1 },
      'pile:9_hearts': { x: 437, y: 201, w: 52, h: 76, rot: 8, back: false, lift: 0, glow: 0, seen: 1 },
    });
    const table: CardTable = {
      rects,
      lamp,
      felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at },
      motion: makeMutable(TABLE_AT_REST),
      pile: at,
      hand: at,
      seats: { top: at, left: at, right: at },
      handLift: makeMutable(0),
    };
    const card = (id: string): Card => ({ id, rank: id.split('_')[0] as Card['rank'], suit: id.split('_')[1] as Card['suit'], isJoker: false });
    await render(
      <CardTableProvider value={table}>
        <CardView card={card('7_clubs')} rectKey="hand:7_clubs" />
        <CardView card={card('3_spades')} faceDown rectKey="fan:top:0" />
        <CardView card={card('9_hearts')} rectKey="pile:9_hearts" />
      </CardTableProvider>
    );
    const glosses = screen.getAllByTestId('card-gloss-spot', { includeHiddenElements: true });
    expect(glosses).toHaveLength(3);
    const before = mockCardRenders.n;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        lamp.value = { ...lamp.value, lx: 200 + i * 50, ly: 120 + (i % 3) * 60, level: 0.5 + i * 0.05 };
        jest.advanceTimersByTime(16);
      });
      seen.add(JSON.stringify(glosses.map(pose)));
    }
    expect(seen.size).toBe(10);
    expect(mockCardRenders.n - before).toBe(0);
  });
});
