// tests/native/tableCoveredVeil.test.tsx — a cover rendered in the `overlays`
// slot has to withdraw the table under it without withdrawing itself. #408's
// veil answers to the settings sheet, which hangs off the rail and so is
// outside the slot; a cover inside the slot cannot share that veil, and a
// source scan cannot tell the two apart.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const WINDOW = { width: 568, height: 320, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => WINDOW,
}));

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
import type { Card, GameState, Player } from '@/lib/gameEngine';

const INSETS = { top: 0, left: 47, right: 34, bottom: 0 };
const METRICS = { frame: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }, insets: INSETS };

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

/**
  * The `A11yStatus` nodes a screen reader can still reach — the table's spoken
  * description and the hand's. The default query already excludes anything
  * withdrawn, by its own props or by an ancestor's, which is the question.
  */
const liveRegions = () =>
  screen
    .queryAllByRole('text')
    .filter(
      (n) =>
        n.props.accessibilityLiveRegion === 'polite' || n.props['aria-live'] === 'polite'
    );

/** True when this node is withdrawn from the accessibility tree on either platform. */
const withdrawn = (props: Record<string, unknown>) =>
  props.accessibilityElementsHidden === true ||
  props.importantForAccessibility === 'no-hide-descendants' ||
  props['aria-hidden'] === true;

async function mount(tableCovered: boolean) {
  return render(
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
        tableCovered={tableCovered}
        // Spread as the real callers do — a mock that drops the veil cannot
        // tell a slot left reachable from one the table's own veil reached.
        overlays={(veiled) => <View testID="the-cover" {...veiled} />}
      />
    </SafeAreaProvider>
  );
}

describe('a cover in the overlays slot', () => {
  it('withdraws the table beneath it from the accessibility tree', async () => {
    const r = await mount(true);
    for (const id of ['game-table', 'game-top-bar', 'game-hud-stack']) {
      // A withdrawn node is not there to be queried by default, which is the
      // same thing a screen reader sees.
      expect(screen.queryByTestId(id)).toBeNull();
      expect(withdrawn(screen.getByTestId(id, { includeHiddenElements: true }).props)).toBe(true);
    }
    await r.unmount();
  });

  // The node a screen reader actually hears: the whole table in one sentence,
  // on a live region. Withdrawing the seats but still reading the board out is
  // the fix half-applied, and the three testIDs above cannot see it.
  it('withdraws the spoken table description with it', async () => {
    const r = await mount(true);
    expect(liveRegions()).toHaveLength(0);
    await r.unmount();
  });

  it('leaves the slot it is rendered in reachable', async () => {
    const r = await mount(true);
    let node = screen.getByTestId('the-cover').parent;
    while (node) {
      expect(withdrawn(node.props as Record<string, unknown>)).toBe(false);
      node = node.parent;
    }
    await r.unmount();
  });

  it('withdraws nothing while no cover is up', async () => {
    const r = await mount(false);
    expect(withdrawn(screen.getByTestId('game-table').props)).toBe(false);
    expect(withdrawn(screen.getByTestId('game-top-bar').props)).toBe(false);
    expect(liveRegions().length).toBeGreaterThan(0);
    await r.unmount();
  });
});
