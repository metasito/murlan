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
const ACTIONS = { onHome: noop, again: null };

type Reason = 'none' | 'settingsOpen' | 'covered' | 'portrait' | 'holdingForStart';
const REASONS: Reason[] = ['none', 'settingsOpen', 'covered', 'portrait', 'holdingForStart'];

/**
 * Each fixture draws children the others do not: between them, every conditional child of the
 * game layer is on screen under every reason.
 */
type Fixture = 'table' | 'scoreOpen' | 'refusal' | 'matchEnd' | 'startCard';
const FIXTURES: Fixture[] = ['table', 'scoreOpen', 'refusal', 'matchEnd', 'startCard'];

function stateFor(fixture: Fixture): GameState {
  if (fixture === 'matchEnd') return { ...STATE, roundOver: true, finishingOrder: ['player_0', 'player_1', 'player_2', 'player_3'] };
  if (fixture === 'startCard') return { ...STATE, firstPlayMade: false, startCard: card('3_1'), startReason: undefined };
  return STATE;
}

async function mount(fixture: Fixture, reason: Reason): Promise<RenderResult> {
  mockWindow.current = reason === 'portrait' ? PORTRAIT : LANDSCAPE;
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsProvider>
        <GameTable
          gameState={stateFor(fixture)}
          viewerSeat={0}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
          matchScore={{ scores: { player_0: 21 }, target: 21 }}
          matchOver={fixture === 'matchEnd'}
          matchWinners={fixture === 'matchEnd' ? ['player_0'] : undefined}
          matchActions={fixture === 'matchEnd' ? ACTIONS : undefined}
          endMatchVote={VOTE}
          roundVote={fixture === 'refusal' ? null : VOTE}
          leftTable={fixture === 'refusal' ? { reclaiming: false, onReclaim: noop, onLeave: noop } : null}
          error={fixture === 'refusal' ? { text: 'Refused', seq: 1 } : null}
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
  const gate = screen.queryByTestId('start-reason-gate', { includeHiddenElements: true });
  if (reason === 'holdingForStart') expect(gate).not.toBeNull();
  else if (gate) await fireEvent.press(gate);
  if (fixture === 'scoreOpen') await fireEvent.press(screen.getByTestId('score-pill', { includeHiddenElements: true }));
  if (reason === 'settingsOpen') await fireEvent.press(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
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

const withdrawn = (props: Record<string, unknown>) =>
  props.accessibilityElementsHidden === true && props.importantForAccessibility === 'no-hide-descendants';

/** Which reasons withdraw each role: the decision `components/table/tableVeils.ts` documents, restated as the expectation. */
const VEILED_UNDER: Record<string, Record<Reason, boolean>> = {
  table: { none: false, settingsOpen: true, covered: true, portrait: true, holdingForStart: true },
  clock: { none: false, settingsOpen: true, covered: true, portrait: true, holdingForStart: false },
  coverOnly: { none: false, settingsOpen: false, covered: true, portrait: true, holdingForStart: true },
  sheetOnly: { none: false, settingsOpen: true, covered: false, portrait: true, holdingForStart: false },
  sheet: { none: false, settingsOpen: true, covered: false, portrait: false, holdingForStart: false },
  /** The layer that is itself the reason: reachable whenever it is drawn. */
  cover: { none: false, settingsOpen: false, covered: false, portrait: false, holdingForStart: false },
};

/** Every child the game layer can hold, and the role that veils it; `silent` holds nothing to stop on. */
const ROLE: Record<string, keyof typeof VEILED_UNDER | 'silent'> = {
  sweep: 'silent',
  'card-shade': 'silent',
  'table-particles': 'silent',
  'grey-scrim': 'silent',
  'notice-whoStarts': 'silent',
  'start-reason-gate': 'silent',
  'notice-errorToast': 'silent',
  'table-status': 'table',
  'game-top-bar': 'table',
  'score-pill-layer': 'table',
  'end-match-vote': 'table',
  'round-vote': 'table',
  'left-table': 'table',
  'float-status': 'table',
  'banner-band': 'table',
  'game-table': 'table',
  'game-hud-stack': 'clock',
  'control-rail-layer': 'coverOnly',
  'the-cover': 'sheetOnly',
  'who-starts-status': 'sheet',
  'settings-veil': 'silent',
  'settings-sheet': 'cover',
  'rotate-overlay': 'cover',
};

/** The fixtures whose opening has a gate to hold the table with. */
const GATED: Fixture[] = ['table', 'scoreOpen', 'refusal'];

/** Drawn only once the round's ending shows them, so what they would say is read off their own veil. */
const DRAWN_BY_ENDING = new Set(['round-vote', 'left-table']);

/** Children a fixture must draw, so a fixture that stops drawing them cannot pass by not looking. */
const DRAWS: Record<Fixture, string[]> = {
  table: ['score-pill-layer', 'end-match-vote', 'round-vote', 'float-status', 'the-cover'],
  scoreOpen: ['score-pill-layer', 'round-vote'],
  refusal: ['left-table', 'float-status'],
  matchEnd: ['score-pill-layer', 'round-vote'],
  startCard: ['who-starts-status', 'notice-whoStarts'],
};

describe('every child of the game layer answers to the veil its role names', () => {
  for (const fixture of FIXTURES) {
    for (const reason of REASONS.filter((r) => r !== 'holdingForStart' || GATED.includes(fixture))) {
      it(`${fixture}, ${reason}`, async () => {
        const view = await mount(fixture, reason);
        const seen = new Set<string>();
        for (const child of hostChildren(screen.getByTestId('game-layer', { includeHiddenElements: true }))) {
          const name = nameOf(child);
          expect(seen.has(name)).toBe(false);
          seen.add(name);
          const role = ROLE[name];
          expect([name, role]).toEqual([name, expect.any(String)]);
          // The rotate overlay is modal: in portrait it hides its siblings whatever their own veil.
          const veiled =
            role === 'silent' || (reason === 'portrait' && role !== 'cover') || VEILED_UNDER[role][reason];
          if (DRAWN_BY_ENDING.has(name)) {
            expect([name, withdrawn(child.props)]).toEqual([name, veiled]);
            continue;
          }
          const reachable = subtree(child).some((n) => stop(n) && !isHiddenFromAccessibility(n));
          expect([name, reachable]).toEqual([name, !veiled]);
        }
        for (const name of DRAWS[fixture]) expect([...seen]).toContain(name);
        if (reason === 'settingsOpen') expect([...seen]).toContain('settings-sheet');
        if (reason === 'portrait') expect([...seen]).toContain('rotate-overlay');
        await view.unmount();
      });
    }
  }

  it('the root holds exactly the felt and the layer the kick moves, beside the bomb flash', async () => {
    const view = await mount('table', 'none');
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
