import { describe, it, expect, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle, makeMutable, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { CardView } from '@/components/CardView';
import { TABLE_AT_REST, type CardRect, type CardRects } from '@/components/table/cardRects';
import type { GlossLight } from '@/components/table/cardGloss';
import { levelShade } from '@/components/table/rail';
import { CardTableProvider, useCardTableValue, type OwnedRects } from '@/components/table/useCardRects';
import { stockLipHeight } from '@/components/cardFaceModel';
import { TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig, type LampRig } from '@/components/table/useLampRig';
import type { Card } from '@/lib/game/gameEngine';
import { Reconnect } from '@/lib/tokens';

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
    const box = (testID: string, inner: string) =>
      StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).queryAll((n) => n.props.testID === inner && typeof n.type === 'string')[0].props.style);
    const face = box('hand', 'card-box');
    expect(box('hand', 'card-level-shade')).toMatchObject({ width: face.width, height: Number(face.height) + stockLipHeight(Number(face.height)) });
  });

  it('follows the lamp rig to the reconnect hold\'s level', async () => {
    jest.useFakeTimers();
    const held: { rig?: LampRig } = {};
    function Rigged({ onRig, children }: { onRig: (rig: LampRig) => void; children: React.ReactNode }) {
      const rig = useLampRig({ pool: TABLE_CENTRE, deal: undefined, width: 874, height: 402, landing: useSharedValue(NO_LANDING) });
      useEffect(() => {
        onRig(rig);
      }, [onRig, rig]);
      return <Table light={rig.glossLight}>{children}</Table>;
    }
    await render(
      <Rigged onRig={(rig) => (held.rig = rig)}>
        <View testID="hand">
          <CardView card={card('7_clubs')} rectKey="hand:7_clubs" rects={owned('hand:7_clubs')} />
        </View>
      </Rigged>
    );
    await act(async () => void jest.advanceTimersByTime(100));
    expect(shadeOf('hand')).toEqual([levelShade(1)]);
    await act(async () => {
      held.rig!.setLevel(Reconnect.lamp, 1000);
      jest.advanceTimersByTime(2000);
    });
    expect(shadeOf('hand')[0]).toBeCloseTo(levelShade(Reconnect.lamp), 2);
    jest.useRealTimers();
  });
});
