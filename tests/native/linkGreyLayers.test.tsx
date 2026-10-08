// tests/native/linkGreyLayers.test.tsx — while the viewer's own link is down the whole table and
// its HUD go grey, layer by layer, and come back in colour once it is up (#1268).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'on',
}));

import { GameTable } from '@/components/GameTable';
import { greyFilter } from '@/components/table/useLinkHold';
import { Layer, Reconnect } from '@/lib/tokens';
import type { Card, GameState, Player } from '@/lib/game/gameEngine';
import type { OwnLink } from '@/lib/ownLink';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [{ id: `s${i}`, rank: '3', suit: 'spades', isJoker: false } as Card],
  type: 'human',
});

const STATE: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 1,
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
const table = (ownLink: OwnLink) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      ownLink={ownLink}
      gameState={STATE}
      matchScore={{ scores: { player_0: 3, player_1: 5, player_2: 0, player_3: 1 }, target: 21 }}
      viewerSeat={0}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const LAYERS = ['table-felt', 'game-top-bar', 'score-pill-layer', 'control-rail-layer', 'game-table'];
const filters = () =>
  LAYERS.map((id) => (getAnimatedStyle(screen.getByTestId(id, { includeHiddenElements: true })) as { filter?: string }).filter);

describe("the table while the viewer's own link is down", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Two mounts, not a rerender: the jest reanimated mock recomputes an animated style only on its
  // view's own render, so the live change is read in tests/e2e/reconnect.spec.ts.
  it.each<[OwnLink, string]>([
    ['lost', greyFilter(Reconnect.grey)],
    ['up', 'none'],
  ])('with the link %s, every layer of the table and its HUD reads %s', async (link, filter) => {
    const view = await render(table(link));
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(filters()).toEqual(LAYERS.map(() => filter));
    await view.unmount();
  });

  it('keeps every greyed layer at the layer it wraps', async () => {
    const view = await render(table('up'));
    const z = (id: string) => StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style).zIndex;
    expect(LAYERS.map(z)).toEqual([Layer.felt, Layer.moment, Layer.moment, Layer.rail, Layer.table]);
    await view.unmount();
  });
});
