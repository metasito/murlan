import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { getAnimatedStyle, makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import type { GlossLight } from '@/components/table/cardGloss';
import { levelShade } from '@/components/table/rail';
import { CardTableProvider, useCardTableValue, type OwnedRects } from '@/components/table/useCardRects';
import type { Card } from '@/lib/game/gameEngine';

const at = { x: 0, y: 0 };
const places = { felt: { sx: 1, sy: 1, s: 1, kickAt: at, shakeAt: at }, pile: at, hand: at, seats: { top: at, left: at, right: at } };
const card = (id: string): Card => ({ id, rank: id.split('_')[0] as Card['rank'], suit: id.split('_')[1] as Card['suit'], isJoker: false });
const rect: CardRect = { x: 437, y: 300, w: 58, h: 84, rot: 0, back: false, lift: 0, glow: 0, seen: 1 };
const owned = (id: string) => makeMutable<CardRects>({ [id]: rect }) as unknown as OwnedRects;

function Table({ light, children }: { light: SharedValue<GlossLight>; children: React.ReactNode }) {
  const value = useCardTableValue(places, useSharedValue(TABLE_AT_REST), useSharedValue(0), light);
  return <CardTableProvider value={value}>{children}</CardTableProvider>;
}

const shadeOf = (testID: string) => {
  const box = screen.getByTestId(testID, { includeHiddenElements: true });
  const shades = box.queryAll((n) => n.props.testID === 'card-level-shade');
  return shades.map((n) => (getAnimatedStyle(n as Parameters<typeof getAnimatedStyle>[0]) as { opacity?: number }).opacity);
};

describe('the lamp level on the cards', () => {
  it('shades each resting card once, as the mockup shades #lit, and leaves a card in flight bright', async () => {
    const light = makeMutable<GlossLight>({ lx: 437, ly: 140, level: 0.75, r: 1, t: 0 });
    const shaded = (id: string, key: string, faceDown = false) => (
      <View testID={id}>
        <CardView card={card('7_clubs')} faceDown={faceDown} rectKey={key} rects={owned(key)} />
      </View>
    );
    await render(
      <Table light={light}>
        {shaded('hand', 'hand:7_clubs')}
        {shaded('pile', 'pile:7_clubs')}
        {shaded('fan', 'fan:top:0', true)}
        {shaded('deal', 'deal:0', true)}
        {shaded('leg', 'leg:0')}
      </Table>
    );
    const opacities = Object.fromEntries(['hand', 'pile', 'fan', 'deal', 'leg'].map((id) => [id, shadeOf(id)]));
    expect(opacities).toEqual({ hand: [levelShade(0.75)], pile: [levelShade(0.75)], fan: [levelShade(0.75)], deal: [], leg: [] });
  });
});
