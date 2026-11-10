// tests/native/fanGlossHandover.test.tsx — where the table has tracks (web), a fan back draws no gloss of its own
// while the fan's picture does, and draws it live, from the swaying light, when it has no `placed` (a glide, or
// the picture not yet drawn); with no tracks it reads the still light, as native does.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from './harness/animatedStyle';
import { makeMutable, useSharedValue } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { LampGloss } from '@/components/table/LampGloss';
import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import type { GlossLight } from '@/components/table/cardGloss';
import { createGlossTracks } from '@/components/table/glossTrackStore';
import { snapOf } from '@/components/table/glossTrack';
import { restingLamp } from '@/components/table/lampRig';
import { CardTableProvider, useCardTableValue, type OwnedRects } from '@/components/table/useCardRects';
import { bootFeedback } from './helpers/feedback';

beforeEach(async () => {
  jest.useFakeTimers();
  await bootFeedback();
});
afterEach(() => {
  jest.useRealTimers();
});

const at = { x: 0, y: 0 };
const places = { felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, pile: at, hand: at, seats: { top: at, left: at, right: at } };
const light = (lx: number): GlossLight => ({ lx, ly: 140, level: 1, r: 1, t: 0 });
const rect: CardRect = { x: 437, y: 40, w: 40, h: 58, rot: 0, back: true, lift: 0, glow: 0, seen: 1 };
const fan = () => makeMutable<CardRects>({ 'fan:top:0': rect }) as unknown as OwnedRects;
const card = { id: '3_spades', rank: '3', suit: 'spades', isJoker: false } as const;

const sway = makeMutable(light(457));
const still = makeMutable(light(300));

function Table({ tracks, live, children }: { tracks: boolean; live?: boolean; children: React.ReactNode }) {
  const [store] = React.useState(() => {
    const made = tracks ? createGlossTracks(snapOf(restingLamp([437, 180, 1]), false), makeMutable(snapOf(restingLamp([437, 180, 1]), false))) : undefined;
    made?.update(null, !!live);
    return made;
  });
  const value = useCardTableValue(places, useSharedValue(TABLE_AT_REST), sway, still, useSharedValue(1), store);
  return <CardTableProvider value={value}>{children}</CardTableProvider>;
}

const spots = () => screen.queryAllByTestId('card-gloss-spot', { includeHiddenElements: true }).length;

describe('an opponent\'s back on a table with tracks', () => {
  it('draws no gloss of its own once the fan\'s picture is drawn', async () => {
    await render(<Table tracks><LampGloss rectKey="fan:top:0" rects={fan()} width={40} height={58} tracked /></Table>);
    expect(spots()).toBe(0);
  });

  it('draws it live while it has no place to be tracked from', async () => {
    await render(<Table tracks><CardView card={card} faceDown rectKey="fan:top:0" rects={fan()} /></Table>);
    expect(spots()).toBe(1);
  });

  it('draws it live without tracks too, as native does', async () => {
    await render(<Table tracks={false}><CardView card={card} faceDown rectKey="fan:top:0" rects={fan()} tracked /></Table>);
    expect(spots()).toBe(1);
  });

  it('draws it live from the still light at rest, and from the swaying light through a glide', async () => {
    const streak = () => JSON.stringify(getAnimatedStyle(screen.getAllByTestId('card-gloss-streak', { includeHiddenElements: true })[0] as never));
    const view = await render(<Table tracks><CardView card={card} faceDown rectKey="fan:top:0" rects={fan()} /></Table>);
    const resting = streak();
    await act(async () => {
      sway.value = light(480);
      jest.advanceTimersByTime(16);
    });
    expect(streak()).toBe(resting);
    await view.unmount();
    await render(<Table tracks live><CardView card={card} faceDown rectKey="fan:top:0" rects={fan()} /></Table>);
    await act(async () => {
      sway.value = light(500);
      jest.advanceTimersByTime(16);
    });
    expect(streak()).not.toBe(resting);
  });
});
