// tests/native/handShadeRebuild.test.tsx — the hand shade's outlines are window points, so they follow the felt (#1466).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import type { CardRect, CardRects, Felt } from '@/components/table/cardRects';
import { TABLE_AT_REST } from '@/components/table/cardRects';
import { HandShadeCanvas } from '@/components/table/handShadeCanvas';
import { TABLE_CENTRE, restingLamp } from '@/components/table/lampRig';
import type { CardTable } from '@/components/table/useCardRects';
import { frames } from './helpers/exchangeLegs';
import { bootFeedback } from './helpers/feedback';

const mockOutlined: { key: string; felt: Pick<Felt, 'sx' | 'sy' | 's'>; midX: number }[] = [];

jest.mock('@/components/table/cardShadows', () => {
  const actual = jest.requireActual<typeof import('@/components/table/cardShadows')>('@/components/table/cardShadows');
  return {
    ...actual,
    addOutline: (...args: Parameters<typeof actual.addOutline>) => {
      const [, r, felt, midX] = args;
      mockOutlined.push({ key: `${r.x}`, felt: { sx: felt.sx, sy: felt.sy, s: felt.s }, midX });
      return actual.addOutline(...args);
    },
  };
});

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
  mockOutlined.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the hand shade on a resize', () => {
  const rect = (over: Partial<CardRect> = {}): CardRect => ({ x: 200, y: 300, w: 64, h: 90, rot: 0, back: false, lift: 0, glow: 0, seen: 1, ...over });

  it('rebuilds its outlines when any felt scale or the hand centre changes and no card moves', async () => {
    const rects = makeMutable<CardRects>({ 'hand:a': rect(), 'hand:b': rect({ x: 230 }) });
    const handOrder = makeMutable<readonly string[]>(['hand:a', 'hand:b']);
    const at = { x: 0, y: 0 };
    type Scale = { sx: number; sy: number; s: number };
    const table = (scale: Scale, handX: number) =>
      ({ rects, handOrder, pileOrder: makeMutable<readonly string[]>([]), felt: { ...scale, kickAt: at, shakeAt: at }, motion: makeMutable(TABLE_AT_REST), pile: at, hand: { x: handX, y: 0 }, seats: {} }) as unknown as CardTable;
    const shade = (scale: Scale, handX: number) => <HandShadeCanvas lamp={makeMutable(restingLamp(TABLE_CENTRE))} cards={table(scale, handX)} ready />;
    // One build outlines the caster, the card below it, then the caster again as what covers its own shadow.
    const BUILD = ['230', '200', '230'];
    const latest = () => mockOutlined.slice(-BUILD.length);

    const view = await render(shade({ sx: 1, sy: 1, s: 1 }, 0));
    await frames(48);
    expect(latest().map((o) => o.key)).toEqual(BUILD);
    const steps: [Scale, number][] = [
      [{ sx: 1.1, sy: 1, s: 1 }, 0],
      [{ sx: 1.1, sy: 1.1, s: 1 }, 0],
      [{ sx: 1.1, sy: 1.1, s: 1.1 }, 0],
      [{ sx: 1.1, sy: 1.1, s: 1.1 }, 30],
    ];
    for (const [scale, handX] of steps) {
      await view.rerender(shade(scale, handX));
      await frames(48);
      expect(latest()).toEqual(BUILD.map((key) => ({ key, felt: scale, midX: handX })));
    }
    await view.unmount();
  });

  it("casts from a card's shadow pose and is covered by the card where it is drawn", async () => {
    const held = (x: number) => rect({ x, shadow: { x: 230, y: 300, w: 64, h: 90, rot: 0 } });
    const rects = makeMutable<CardRects>({ 'hand:a': rect(), 'hand:b': held(234) });
    const at = { x: 0, y: 0 };
    const cards = { rects, handOrder: makeMutable<readonly string[]>(['hand:a', 'hand:b']), pileOrder: makeMutable<readonly string[]>([]), felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, motion: makeMutable(TABLE_AT_REST), pile: at, hand: { x: 0, y: 0 }, seats: {} } as unknown as CardTable;
    const view = await render(<HandShadeCanvas lamp={makeMutable(restingLamp(TABLE_CENTRE))} cards={cards} ready />);
    await frames(48);
    expect(mockOutlined.slice(-3).map((o) => o.key)).toEqual(['230', '200', '234']);
    rects.value = { 'hand:a': rect(), 'hand:b': rect({ x: 230 }) };
    await frames(48);
    expect(mockOutlined.slice(-3).map((o) => o.key)).toEqual(['230', '200', '230']);
    await view.unmount();
  });
});
