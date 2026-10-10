// tests/native/cardGloss.test.tsx — every card view on the table carries the lamp's gloss, read from its
// own rect and the lamp on the UI thread, so moving the lamp re-renders no card (#1260).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { getAnimatedStyle, makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import { GLOSS_FRAME_S, type GlossLight } from '@/components/table/cardGloss';
import type { Pool } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig } from '@/components/table/useLampRig';
import { CardTableProvider, useCardRect, useCardTable, useCardTableValue, type OwnedRects } from '@/components/table/useCardRects';
import type { Card } from '@/lib/game/gameEngine';
import { frames } from './helpers/exchangeLegs';
import { throwPair } from './helpers/landing';
import { bootFeedback } from './helpers/feedback';

const mockCardRenders = { n: 0 };
const mockGlossRuns = { n: 0 };
jest.mock('@/components/table/cardGloss', () => {
  const actual = jest.requireActual('@/components/table/cardGloss') as typeof import('@/components/table/cardGloss');
  return {
    ...actual,
    cardGloss: (...args: Parameters<typeof actual.cardGloss>) => {
      mockGlossRuns.n += 1;
      return actual.cardGloss(...args);
    },
    glossSpot: (...args: Parameters<typeof actual.glossSpot>) => {
      mockGlossRuns.n += 1;
      return actual.glossSpot(...args);
    },
  };
});
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

const at = { x: 0, y: 0 };
const places = { felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, pile: at, hand: at, seats: { top: at, left: at, right: at } };
const card = (id: string): Card => ({ id, rank: id.split('_')[0] as Card['rank'], suit: id.split('_')[1] as Card['suit'], isJoker: false });
const rectAt = (x: number, y: number): CardRect => ({ x, y, w: 58, h: 84, rot: 0, back: false, lift: 0, glow: 0, seen: 1 });

const lightAt = (lx: number, ly: number, level = 1): GlossLight => ({ lx, ly, level, r: 1, t: 0 });

function Table({ light, children }: { light: SharedValue<GlossLight>; children: React.ReactNode }) {
  const value = useCardTableValue(places, useSharedValue(TABLE_AT_REST), useSharedValue(0), light);
  return <CardTableProvider value={value}>{children}</CardTableProvider>;
}

function RiggedTable({ pool, children }: { pool: Pool; children: React.ReactNode }) {
  const rig = useLampRig({ pool, deal: undefined, width: 874, height: 402, landing: useSharedValue(NO_LANDING) });
  return <Table light={rig.glossLight}>{children}</Table>;
}

function Published({ id, x }: { id: string; x: SharedValue<number> }) {
  const rects = useCardRect(useCardTable(), `hand:${id}`, true, () => {
    'worklet';
    return rectAt(x.value, 330);
  });
  return <CardView card={card(id)} rectKey={`hand:${id}`} rects={rects} />;
}

const settle = () => act(async () => void jest.advanceTimersByTime(32));
const glossRunsOver = async (move: () => void) => {
  await settle();
  const before = mockGlossRuns.n;
  await act(async () => {
    move();
    jest.advanceTimersByTime(32);
  });
  return mockGlossRuns.n - before;
};

describe('another card moving', () => {
  it('re-runs only the moved card\'s gloss', async () => {
    const xs = [makeMutable(300), makeMutable(500)];
    await render(
      <Table light={makeMutable(lightAt(437, 140))}>
        <Published id="7_clubs" x={xs[0]} />
        <Published id="9_hearts" x={xs[1]} />
      </Table>
    );
    expect(await glossRunsOver(() => (xs[0].value = 340))).toBe(2);
  });
});

describe('moving the lamp', () => {
  const owned = (id: string, r: CardRect) => makeMutable<CardRects>({ [id]: r }) as unknown as OwnedRects;
  const threeCards = (
    <>
      <CardView card={card('7_clubs')} rectKey="hand:7_clubs" rects={owned('hand:7_clubs', rectAt(437, 330))} />
      <CardView card={card('3_spades')} faceDown rectKey="fan:top:0" rects={owned('fan:top:0', { ...rectAt(437, 40), w: 40, h: 58, back: true })} />
      <CardView card={card('9_hearts')} rectKey="pile:9_hearts" rects={owned('pile:9_hearts', { ...rectAt(437, 201), w: 52, h: 76, rot: 8 })} />
    </>
  );
  const glossPoses = () => screen.getAllByTestId('card-gloss-spot', { includeHiddenElements: true }).map((n) => JSON.stringify(pose(n)));

  it('moves every gloss and re-renders no card', async () => {
    const light = makeMutable(lightAt(437, 140));
    await render(<Table light={light}>{threeCards}</Table>);
    expect(glossPoses()).toHaveLength(3);
    const before = mockCardRenders.n;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        light.value = lightAt(200 + i * 50, 120 + (i % 3) * 60, 0.5 + i * 0.05);
        jest.advanceTimersByTime(16);
      });
      seen.add(glossPoses().join());
    }
    expect(seen.size).toBe(10);
    expect(mockCardRenders.n - before).toBe(0);
  });

  it('follows the rig\'s lamp to a new pool', async () => {
    const view = await render(<RiggedTable pool={[437, 180, 1]}>{threeCards}</RiggedTable>);
    await act(async () => void jest.advanceTimersByTime(3000));
    const resting = glossPoses();
    await view.rerender(<RiggedTable pool={[150, 300, 1]}>{threeCards}</RiggedTable>);
    await act(async () => void jest.advanceTimersByTime(3000));
    expect(glossPoses().map((p, i) => p === resting[i])).toEqual([false, false, false]);
  });

  it('poses each gloss at most once a gloss frame while the rig glides to a new pool', async () => {
    const view = await render(<RiggedTable pool={[437, 180, 1]}>{threeCards}</RiggedTable>);
    await act(async () => void jest.advanceTimersByTime(3000));
    const before = mockGlossRuns.n;
    await view.rerender(<RiggedTable pool={[150, 300, 1]}>{threeCards}</RiggedTable>);
    await act(async () => void jest.advanceTimersByTime(1000));
    const posesPerCard = (mockGlossRuns.n - before) / 6;
    expect(posesPerCard).toBeGreaterThan(10);
    expect(posesPerCard).toBeLessThanOrEqual(Math.ceil(1 / GLOSS_FRAME_S));
  });
});
