// tests/native/tableCoveredVeil.test.tsx — a cover rendered in the `overlays`
// slot has to withdraw the table under it without withdrawing itself. #408's
// veil answers to the settings sheet, which hangs off the rail and so is
// outside the slot; a cover inside the slot cannot share that veil, and a
// source scan cannot tell the two apart.
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import {
  act,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { liveRegions } from '../helpers/liveRegions';

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
import { A11yStatus } from '@/lib/a11y';
import { tn } from '@/lib/i18n';

/** A caller's own live region, in the slot the table veils along with itself. */
const BANNER = 'P1 has left the table.';

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
 * description and the hand's. Narrowed from the shared finder, which reports a
 * withdrawn region too: whether an ancestor's veil reached this node is the
 * question here, and `isHiddenFromAccessibility` is what walks that chain.
 */
const reachableRegions = () =>
  liveRegions(screen).filter((n) => !isHiddenFromAccessibility(n));

/** True when this node is withdrawn from the accessibility tree on either platform. */
const withdrawn = (props: Record<string, unknown>) =>
  props.accessibilityElementsHidden === true ||
  props.importantForAccessibility === 'no-hide-descendants' ||
  props['aria-hidden'] === true;

const tree = (tableCovered: boolean, turnTimer?: { seconds: number; resetKey: string }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        turnTimer={turnTimer && { ...turnTimer, includeNewRound: true, onExpire: noop }}
        banners={<A11yStatus label={BANNER} />}
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

async function mount(tableCovered: boolean) {
  return render(tree(tableCovered));
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
    expect(reachableRegions()).toHaveLength(0);
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

  // The cover paints over the rail — it is absoluteFill at z 100 inside a z 300
  // slot, the rail is at z 20 — so a sighted player cannot reach the settings
  // knob under it. #408 exempted the rail from the veil unconditionally because
  // the knob closes the settings sheet; a cover has no close control, so under
  // one the exemption hands a screen reader a control nobody else has.
  it('withdraws the control rail, which it paints over', async () => {
    const r = await mount(true);
    expect(screen.queryByTestId('control-rail')).toBeNull();
    expect(
      withdrawn(screen.getByTestId('control-rail', { includeHiddenElements: true }).props)
    ).toBe(true);
    await r.unmount();
  });

  // Every region the table veils changes its sentence where nobody can hear it
  // and comes back already holding it — the countdown under the hud stack's own
  // veil (#1004), and a caller's banner in the slot the table veils with itself.
  it('gives every region it veils its sentence back when the cover lifts', async () => {
    // Fake timers, because the empty frame and the sentence are one task apart
    // and the harness's own `await` would run that task before either is read.
    jest.useFakeTimers();
    const timer = { seconds: 30, resetKey: 'turn-1' };
    const r = await render(tree(true, timer));
    expect(reachableRegions()).toHaveLength(0);

    await r.rerender(tree(false, timer));
    const spoken = () => reachableRegions().map((n) => String(n.props.accessibilityLabel ?? ''));
    expect(spoken().filter(Boolean)).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(spoken()).toContain(tn('gameTable.a11ySecondsLeft', 30));
    expect(spoken()).toContain(BANNER);

    await r.unmount();
    jest.useRealTimers();
  });

  it('withdraws nothing while no cover is up', async () => {
    const r = await mount(false);
    expect(withdrawn(screen.getByTestId('game-table').props)).toBe(false);
    expect(withdrawn(screen.getByTestId('game-top-bar').props)).toBe(false);
    expect(reachableRegions().length).toBeGreaterThan(0);
    await r.unmount();
  });
});
