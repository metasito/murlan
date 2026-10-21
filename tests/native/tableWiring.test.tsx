// tests/native/tableWiring.test.tsx — the table hands each edge and each control the number its
// model computes. Rendered props only: no flexbox runs here, so where the boxes land is
// tests/e2e/'s; that GameTable passes the model's numbers on is this file's.
import { describe, it, expect, beforeEach } from '@jest/globals';
import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameTable } from '@/components/GameTable';
import { tableLayout } from '@/components/tableLayout';
import { actionBtnSize } from '@/components/seatLayout';
import { cardScale, physicalTouchTarget } from '@/components/cardFaceModel';
import { TOUCH_TARGET_MIN } from '@/lib/tokens';
import { t } from '@/lib/i18n';
import { SettingsProvider } from '@/context/SettingsContext';
import { RANK_SLOTS, type Card, type GameState, type Player } from '@/lib/game/gameEngine';
import { setStoredMotion, setWindow } from './harness/env';

type Insets = { top: number; left: number; right: number; bottom: number };
const SCREENS: { name: string; width: number; height: number; insets: Insets }[] = [
  { name: 'iPhone SE, no cutout', width: 568, height: 320, insets: { top: 0, left: 0, right: 0, bottom: 0 } },
  { name: 'iPhone 12, notch and home bar', width: 844, height: 390, insets: { top: 0, left: 47, right: 47, bottom: 21 } },
  { name: 'iPad Pro, with surplus', width: 1366, height: 1024, insets: { top: 24, left: 0, right: 0, bottom: 20 } },
];

const card = (id: string): Card => ({ id, rank: '3', suit: 'spades', isJoker: false });
const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [card(`3_${i}`), card(`4_${i}`)], type: 'human' });

/** The viewer's turn mid-round, so PASSA and GIOCA are both on the table. */
const STATE: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  lastMove: { seq: 0, kind: 'deal' },
  startReason: { type: 'lost_round', playerIdx: 0 },
  playedRanks: Array.from({ length: RANK_SLOTS }, () => 0),
};

const noop = () => {};

async function mount({ width, height, insets }: (typeof SCREENS)[number]) {
  await setWindow({ width, height, scale: 2, fontScale: 1 });
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets }}>
      <SettingsProvider>
        <GameTable gameState={STATE} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
      </SettingsProvider>
    </SafeAreaProvider>
  );
  const gate = screen.queryByTestId('start-reason-gate', { includeHiddenElements: true });
  if (gate) await fireEvent.press(gate);
  const scale = cardScale(Math.min(width, height));
  return { scale, layout: tableLayout({ width, height, insets, scale }) };
}

type Node = NonNullable<ReturnType<typeof screen.queryByTestId>>;

const styleOf = (node: Node): TextStyle => {
  const style = node.props.style;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {};
};
const byTestId = (id: string) => screen.getByTestId(id, { includeHiddenElements: true });
const kids = (node: Node): Node[] => node.children.filter((c): c is Node => typeof c !== 'string');
const subtree = (node: Node): Node[] => [node, ...kids(node).flatMap(subtree)];

beforeEach(() => setStoredMotion('on'));

it('the screens tell each floored pad, and a surplus, from the raw numbers', () => {
  const frames = SCREENS.map(({ width, height, insets }) => ({
    insets,
    frame: tableLayout({ width, height, insets, scale: cardScale(Math.min(width, height)) }).frame,
  }));
  expect(frames.some(({ frame, insets }) => frame.tableTop !== insets.top)).toBe(true);
  expect(frames.some(({ frame, insets }) => frame.tableBottom !== insets.bottom)).toBe(true);
  expect(frames.some(({ frame }) => frame.surplus > 0)).toBe(true);
});

describe.each(SCREENS)('on $name', (screenSize) => {
  it('draws the table bottom edge at the surplus, and the rail and the sheet at the floored pads', async () => {
    const { layout } = await mount(screenSize);
    const { frame } = layout;

    expect(styleOf(byTestId('game-table')).bottom).toBe(frame.surplus);

    const rail = styleOf(byTestId('control-rail'));
    expect([rail.paddingTop, rail.paddingBottom]).toEqual([frame.tableTop, frame.tableBottom]);

    await fireEvent.press(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
    const sheet = styleOf(byTestId('settings-sheet'));
    expect([sheet.top, sheet.bottom]).toEqual([frame.tableTop, frame.tableBottom]);
  });

  it('sizes the rail knob, PASSA, GIOCA and the sheet exit by the touch-target model', async () => {
    const { scale } = await mount(screenSize);

    const knob = styleOf(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
    expect([knob.width, knob.height]).toEqual([physicalTouchTarget(scale), physicalTouchTarget(scale)]);

    for (const id of ['btn-passa-box', 'btn-gioca-box']) {
      const box = styleOf(byTestId(id));
      expect([box.width, box.height]).toEqual([actionBtnSize(scale), actionBtnSize(scale)]);
    }

    await fireEvent.press(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
    const exit = subtree(byTestId('settings-exit')).map(styleOf).find((s) => s.minHeight !== undefined);
    expect(exit?.minHeight).toBe(physicalTouchTarget(scale));
  });
});

it("the sheet exit's own padding and label fall under a thumb on a phone, so its floor is doing the work", async () => {
  const { scale } = await mount(SCREENS[0]);
  await fireEvent.press(screen.getByLabelText(t('gameTable.settingsA11yLabel')));
  const nodes = subtree(byTestId('settings-exit'));
  const gradient = nodes.map(styleOf).find((s) => s.minHeight !== undefined);
  const label = nodes.find((n) => n.type === 'Text' && styleOf(n).fontSize !== undefined);
  expect(gradient?.paddingVertical).toBeDefined();
  expect(label).toBeDefined();
  const unfloored = 2 * Number(gradient!.paddingVertical) + Number(styleOf(label!).fontSize);
  expect(unfloored).toBeLessThan(TOUCH_TARGET_MIN);
  expect(gradient!.minHeight).toBe(physicalTouchTarget(scale));
});
