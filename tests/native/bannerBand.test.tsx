// tests/native/bannerBand.test.tsx — the `banners` slot is a band under the HUD
// chips, not something each caller positions. In flow it landed at y 0, where
// the chrome and the felt both painted over it — which is how the replay
// transport became untappable on a phone.
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { CHIP_H } from '@/components/seatLayout';
import { computeTableFrame } from '@/components/tableFrame';
import { cardScale } from '@/components/cardFaceModel';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import { setMotion, setWindow } from './harness/env';
import { emptyRankTally } from '@/lib/game/gameEngine';

// Two windows of different card scale, so of different chip height: the band follows the one now.
const WINDOW = { width: 568, height: 320, scale: 2, fontScale: 1 };
const WIDE = { width: 932, height: 430, scale: 3, fontScale: 1 };

const INSETS = { top: 0, left: 47, right: 34, bottom: 0 };
const METRICS = { frame: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }, insets: INSETS };
const bandTop = (w: { width: number; height: number }) => {
  const scale = cardScale(Math.min(w.width, w.height));
  const frame = computeTableFrame({ width: w.width, height: w.height, insets: INSETS, scale });
  return frame.tableTop + CHIP_H(scale) + frame.pad;
};

const card = (id: string): Card => ({ id, rank: '3', suit: 'spades', isJoker: false });
const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [card(`3_${i}`)],
  type: 'human',
});

const gameState: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  playedRanks: emptyRankTally(),
  lastMove: { seq: 0, kind: 'deal' },
};

const noop = () => {};

describe('the banners slot', () => {
  it('is a band below the HUD chips, over the felt', async () => {
    await setMotion('on');
    await setWindow(WIDE);
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable
          gameState={gameState}
          viewerSeat={0}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
          banners={<View testID="banner-content" />}
        />
      </SafeAreaProvider>
    );
    const band = () => StyleSheet.flatten(screen.getByTestId('banner-content').parent!.props.style);
    expect(band().top).toBe(bandTop(WIDE));
    await setWindow(WINDOW);
    const style = band();
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(bandTop(WINDOW));
    expect(style.zIndex).toBeGreaterThan(10);
    expect(style.pointerEvents).toBe('box-none');
    await r.unmount();
  });
});
