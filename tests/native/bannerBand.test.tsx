// tests/native/bannerBand.test.tsx — the `banners` slot is a band under the top
// bar, not something each caller positions. In flow it landed at y 0, where the
// top bar and the opaque felt both painted over it — which is how the replay
// transport became untappable on a phone.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: () => {}, remove: () => {}, seekTo: async () => {}, volume: 1 }),
  setAudioModeAsync: async () => {},
}));

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import { TOP_BAR_H, computeScreenPads } from '@/components/gameTableModel';
import type { Card, GameState, Player } from '@/lib/gameEngine';

const INSETS = { top: 0, left: 47, right: 34, bottom: 0 };
const METRICS = { frame: { x: 0, y: 0, width: 568, height: 320 }, insets: INSETS };
const { topPad } = computeScreenPads({ insets: INSETS, isWeb: false });

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
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};

const noop = () => {};

describe('the banners slot', () => {
  it('is a band below the top bar, over the felt', async () => {
    const r = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable
          gameState={gameState}
          viewerSeat={0}
          selectedIds={[]}
          onSelectCard={noop}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
          roundLabel="Partita"
          banners={<View testID="banner-content" />}
        />
      </SafeAreaProvider>
    );
    const band = screen.getByTestId('banner-content').parent!;
    const style = StyleSheet.flatten(band.props.style);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(topPad + TOP_BAR_H);
    expect(style.zIndex).toBeGreaterThan(10);
    expect(style.pointerEvents).toBe('box-none');
    await r.unmount();
  });
});
