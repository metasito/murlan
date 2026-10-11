// tests/native/foilGlint.test.tsx — every back on the table glints through its own foil mask, following
// the lamp on the UI thread, so moving the lamp re-renders no card (#1465).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { Platform } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { getAnimatedStyle, makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import type { GlossLight } from '@/components/table/cardGloss';
import { CardTableProvider, useCardTableValue, type OwnedRects } from '@/components/table/useCardRects';
import { CARD_BACK_IDS } from '@/lib/cosmetics';
import type { Card } from '@/lib/game/gameEngine';
import { CardGloss } from '@/lib/theme';

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

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const at = { x: 0, y: 0 };
const places = { felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, pile: at, hand: at, seats: { top: at, left: at, right: at } };
const CARD: Card = { id: '3_spades', rank: '3', suit: 'spades', isJoker: false };
const backAt = (x: number, y: number, rot = 0): CardRect => ({ x, y, w: 40, h: 58, rot, back: true, lift: 0, glow: 0, seen: 1 });
const lightAt = (lx: number, ly: number, level = 1): GlossLight => ({ lx, ly, level, r: 1, t: 0 });
const owned = (id: string, r: CardRect) => makeMutable<CardRects>({ [id]: r }) as unknown as OwnedRects;

function Table({ light, children }: { light: SharedValue<GlossLight>; children: React.ReactNode }) {
  const value = useCardTableValue(places, useSharedValue(TABLE_AT_REST), useSharedValue(0), light);
  return <CardTableProvider value={value}>{children}</CardTableProvider>;
}

type Pose = { opacity?: number; transform?: Record<string, number | string>[] };
const pose = (n: TestInstance) => getAnimatedStyle(n as Parameters<typeof getAnimatedStyle>[0]) as Pose;
const opts = { includeHiddenElements: true };
const imageUris = (n: TestInstance) => n.queryAll((c) => c.type === 'Image').map((i) => (i.props.source as { testUri?: string }).testUri);

describe('the foil glint', () => {
  it.each(CARD_BACK_IDS)('masks the %s back with its own foil, in its own colour', async (id) => {
    await render(
      <Table light={makeMutable(lightAt(437, 140))}>
        <CardView card={CARD} faceDown backId={id} rectKey="fan:top:0" rects={owned('fan:top:0', backAt(437, 300))} />
      </Table>
    );
    const glint = screen.getByTestId('card-foil-glint', opts);
    expect(imageUris(glint)).toEqual([expect.stringMatching(new RegExp(`foil_${id}\\.webp$`))]);
    const ink = screen.getByTestId('card-foil-ink', opts);
    expect(ink.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: id === 'zaffiro' ? CardGloss.foil.silver : CardGloss.foil.gold })]));
    expect(pose(ink).opacity).toBeCloseTo(CardGloss.foil.alpha.edge, 6);
    expect(pose(screen.getByTestId('card-foil-band', opts)).opacity).toBeGreaterThan(0);
  });

  it('costs a back no more host views than its mask, ink and band need', async () => {
    await render(
      <Table light={makeMutable(lightAt(437, 140))}>
        <CardView card={CARD} faceDown rectKey="fan:top:0" rects={owned('fan:top:0', backAt(437, 300))} />
      </Table>
    );
    const glint = screen.getByTestId('card-foil-glint', opts);
    expect(glint.queryAll((c) => typeof c.type === 'string').length).toBe(Platform.select({ ios: 5, default: 6 }));
  });

  it('draws nothing on a face-up card or off the table', async () => {
    const view = await render(
      <Table light={makeMutable(lightAt(437, 140))}>
        <CardView card={CARD} rectKey="hand:3_spades" rects={owned('hand:3_spades', { ...backAt(437, 300), back: false })} />
      </Table>
    );
    expect(screen.queryAllByTestId('card-foil-glint', opts)).toHaveLength(0);
    await view.rerender(<CardView card={CARD} faceDown />);
    expect(screen.queryAllByTestId('card-foil-glint', opts)).toHaveLength(0);
  });

  it('follows the lamp and re-renders no card', async () => {
    const light = makeMutable(lightAt(437, 140));
    await render(
      <Table light={light}>
        <CardView card={CARD} faceDown rectKey="fan:top:0" rects={owned('fan:top:0', backAt(437, 40))} />
        <CardView card={CARD} faceDown rectKey="fan:left:0" rects={owned('fan:left:0', backAt(120, 200, 90))} />
      </Table>
    );
    const bandPoses = () => screen.getAllByTestId('card-foil-band', opts).map((n) => JSON.stringify(pose(n)));
    expect(bandPoses()).toHaveLength(2);
    const before = mockCardRenders.n;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        light.value = lightAt(200 + i * 50, 120 + (i % 3) * 60, 0.5 + i * 0.05);
        jest.advanceTimersByTime(16);
      });
      seen.add(bandPoses().join());
    }
    expect(seen.size).toBe(10);
    expect(mockCardRenders.n - before).toBe(0);
  });
});
