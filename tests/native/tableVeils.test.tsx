// tests/native/tableVeils.test.tsx — which of the game layer's children a screen reader can
// still reach under each reason the table is taken away (#408, #1690).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fireEvent, isHiddenFromAccessibility, render, screen, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LANDSCAPE = { width: 844, height: 390, scale: 2, fontScale: 1 };
const PORTRAIT = { width: 390, height: 844, scale: 2, fontScale: 1 };
const mockWindow = { current: LANDSCAPE };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => true,
  setMotionPreference: () => {},
  getMotionPreference: () => 'off',
}));

import { GameTable } from '@/components/GameTable';
import { t } from '@/lib/i18n';
import { SettingsProvider } from '@/context/SettingsContext';
import { RANK_SLOTS, type Card, type GameState, type Player } from '@/lib/game/gameEngine';

const METRICS = { frame: { x: 0, y: 0, width: LANDSCAPE.width, height: LANDSCAPE.height }, insets: { top: 0, left: 47, right: 0, bottom: 21 } };
const card = (id: string): Card => ({ id, rank: '3', suit: 'spades', isJoker: false });
const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [card(`3_${i}`), card(`4_${i}`)], type: 'human' });

/** A round whose opening is still to be played, so the start panel shows and, until tapped, holds the table. */
const STATE: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 1,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  trickWinner: null,
  roundOver: false,
  finishingOrder: [],
  firstPlayMade: true,
  startReason: { type: 'lost_round', playerIdx: 1 },
  playedRanks: Array.from({ length: RANK_SLOTS }, () => 0),
};

const noop = () => {};
const VOTE = { voted: false, votes: 1, total: 4, onPress: noop };

type Reason = 'none' | 'settingsOpen' | 'covered' | 'portrait' | 'holdingForStart';

async function mount(reason: Reason): Promise<RenderResult> {
  mockWindow.current = reason === 'portrait' ? PORTRAIT : LANDSCAPE;
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsProvider>
      <GameTable
        gameState={STATE}
        viewerSeat={0}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
        matchScore={{ scores: { player_0: 3 }, target: 21 }}
        endMatchVote={VOTE}
        roundVote={VOTE}
        banners={<Text>Banner</Text>}
        tableCovered={reason === 'covered'}
        overlays={(veiled) => (
          <View testID="the-cover" {...veiled}>
            <Text>Cover</Text>
          </View>
        )}
      />
      </SettingsProvider>
    </SafeAreaProvider>
  );
  if (reason !== 'holdingForStart') {
    await fireEvent.press(screen.getByTestId('start-reason-gate', { includeHiddenElements: true }));
  }
  if (reason === 'settingsOpen') {
    await fireEvent.press(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
  }
  return view;
}

type Node = NonNullable<ReturnType<typeof screen.queryByTestId>>;

const kids = (node: Node): Node[] => node.children.filter((c): c is Node => typeof c !== 'string');
const subtree = (node: Node): Node[] => [node, ...kids(node).flatMap(subtree)];

/** The nearest host views under `node`: what it lays out, whichever component drew them. */
const hostChildren = (node: Node): Node[] =>
  kids(node).flatMap((child) => (typeof child.type === 'string' ? [child] : hostChildren(child)));

/** A child by its own testID, or the first one inside it. */
const nameOf = (node: Node): string =>
  subtree(node).find((n) => typeof n.props.testID === 'string')?.props.testID ?? `untitled ${String(node.type)}`;

/** Where a screen reader stops: an accessible element, or text. */
const stop = (n: Node) => typeof n.type === 'string' && (n.props.accessible === true || n.type === 'Text');

/** Each of the game layer's children, and whether a screen reader can still stop on anything in it. */
function reachable(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const child of hostChildren(screen.getByTestId('game-layer', { includeHiddenElements: true }))) {
    const name = nameOf(child);
    expect(out).not.toHaveProperty(name);
    out[name] = subtree(child).some((n) => stop(n) && !isHiddenFromAccessibility(n));
  }
  return out;
}

const withdrawn = (props: Record<string, unknown>) =>
  props.accessibilityElementsHidden === true && props.importantForAccessibility === 'no-hide-descendants';

/**
 * Nothing to stop on whatever the table is doing. The round's vote is drawn only by the round's
 * ending, and the reconnect scrim only where the platform darkens rather than greys.
 */
const SILENT = { sweep: false, 'card-shade': false, 'table-particles': false, 'round-vote': false };
const TABLE = ['table-status', 'game-top-bar', 'score-pill-layer', 'end-match-vote', 'float-status', 'banner-band', 'game-table'];
const OPEN = Object.fromEntries([...TABLE, 'game-hud-stack', 'control-rail-layer', 'the-cover'].map((n) => [n, true]));
const off = (...names: string[]) => Object.fromEntries(names.map((n) => [n, false]));

const EXPECTED: Record<Reason, Record<string, boolean>> = {
  none: { ...SILENT, ...OPEN },
  settingsOpen: {
    ...SILENT,
    ...OPEN,
    ...off(...TABLE, 'game-hud-stack', 'the-cover', 'settings-veil'),
    'settings-sheet': true,
  },
  covered: { ...SILENT, ...OPEN, ...off(...TABLE, 'game-hud-stack', 'control-rail-layer') },
  portrait: { ...SILENT, ...OPEN, ...off(...TABLE, 'game-hud-stack', 'control-rail-layer', 'the-cover'), 'rotate-overlay': true },
  holdingForStart: {
    ...SILENT,
    ...OPEN,
    ...off(...TABLE, 'control-rail-layer', 'notice-whoStarts', 'start-reason-gate'),
    'who-starts-status': true,
  },
};

describe('every child of the game layer answers to the veil its role names', () => {
  for (const reason of Object.keys(EXPECTED) as Reason[]) {
    it(reason, async () => {
      const view = await mount(reason);
      const { 'grey-scrim': scrim = false, ...found } = reachable();
      expect(scrim).toBe(false);
      expect(found).toEqual(EXPECTED[reason]);
      expect(withdrawn(screen.getByTestId('round-vote', { includeHiddenElements: true }).props)).toBe(reason !== 'none');
      await view.unmount();
    });
  }

  it('the root holds exactly the felt and the layer the kick moves, beside the bomb flash', async () => {
    const view = await mount('none');
    const root = screen.getByTestId('game-root', { includeHiddenElements: true });
    expect(hostChildren(root).map(nameOf)).toEqual(['table-felt', 'game-layer', 'bomb-flash']);
    for (const id of ['table-felt', 'bomb-flash']) {
      const style = StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
      expect(style).toMatchObject({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 });
      for (const step of (style.transform ?? []) as Record<string, number>[]) {
        expect(Object.keys(step)).toEqual(['scale']);
        expect(step.scale).toBeGreaterThanOrEqual(1);
      }
    }
    await view.unmount();
  });
});
