import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setMotionPreference } from '@/lib/accessibility';
import { Motion } from '@/lib/theme';
import { FloatSlot, type Float } from '@/components/table/notices/floats';
import { noticeRise } from '@/components/table/noticeModel';
import { GameTable } from '@/components/GameTable';
import { buildCombination, type Card, type GameState, type Player } from '@/lib/game/gameEngine';

const PLATE = 'notice-passFloat';
const hidden = { includeHiddenElements: true };
const AT = { x: 200, y: 100 };
const { enter, hold, exit } = Motion.mark;

const slot = (float: Float | null) => <FloatSlot float={float} at={AT} scale={1} veiled={false} />;
const drawn = () => {
  const style = getAnimatedStyle(screen.getByTestId(PLATE, hidden)) as { opacity?: number; transform?: Record<string, number>[] };
  return { opacity: style.opacity, rise: style.transform?.find((t) => 'translateY' in t)?.translateY };
};
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const liveRegion = () => screen.UNSAFE_getByProps({ accessibilityLiveRegion: 'polite' });

beforeEach(async () => {
  jest.useFakeTimers();
  await act(async () => setMotionPreference('off'));
});
afterEach(async () => {
  await act(async () => setMotionPreference('system'));
  jest.useRealTimers();
});

describe('the float slot', () => {
  it('rises and fades in over 100 ms, holds 1000 ms, fades out over 100 ms, and stays out', async () => {
    const r = await render(slot({ id: 1, text: 'Passo' }));
    expect(drawn()).toEqual({ opacity: 0, rise: noticeRise(1, false) });
    await advance(enter + 16);
    expect(drawn()).toEqual({ opacity: 1, rise: 0 });
    await advance(hold - 32);
    expect(drawn().opacity).toBe(1);
    await advance(exit + 32);
    expect(drawn().opacity).toBe(0);
    await advance(5000);
    expect(drawn().opacity).toBe(0);
    await r.unmount();
  });

  it('a second float replaces the first and restarts its life, under the same live region', async () => {
    const r = await render(slot({ id: 1, text: 'Passo' }));
    await advance(enter + hold / 2);
    const region = liveRegion();

    await r.rerender(slot({ id: 2, text: 'Passo' }));
    expect(screen.getAllByTestId(PLATE, hidden)).toHaveLength(1);
    expect(drawn().opacity).toBe(0);
    await advance(enter + hold - 16);
    expect(drawn().opacity).toBe(1);
    expect(liveRegion()).toBe(region);
    await r.unmount();
  });

  it('keeps its live region mounted with no float up, and the plate is never a stop of its own', async () => {
    const r = await render(slot(null));
    const region = liveRegion();
    expect(screen.queryByTestId(PLATE, hidden)).toBeNull();

    await r.rerender(slot({ id: 1, text: 'Passo' }));
    await advance(enter);
    expect(liveRegion()).toBe(region);
    expect(region.props.accessibilityLabel).toBe('Passo');
    expect(screen.queryByTestId(PLATE)).toBeNull();
    expect(screen.getByTestId(PLATE, hidden)).toBeTruthy();
    await r.unmount();
  });
});

const card = (id: string, rank: Card['rank']): Card => ({ id, rank, suit: 'spades', isJoker: false });
const seat = (i: number, name: string): Player => ({
  id: `player_${i}`,
  name,
  hand: [card(`3_${i}`, '3'), card(`4_${i}`, '4')],
  type: 'human',
});
/** Besi played; the turn runs down from seat 1, so Ana (0) answers first. */
const LED: GameState = {
  players: ['Ana', 'Besi', 'Cimi', 'Drin'].map((n, i) => seat(i, n)),
  currentTurnIndex: 0,
  lastPlayedCombination: buildCombination([card('5_hearts', '5')]),
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const METRICS = { frame: { x: 0, y: 0, width: 874, height: 402 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const noop = () => {};
const table = (state: GameState, viewerSeat: number, spectating = false) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={state} viewerSeat={viewerSeat} spectating={spectating} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
  </SafeAreaProvider>
);
const floats = () => screen.queryAllByTestId(PLATE, hidden).length;

describe('the table puts up the viewer’s own pass', () => {
  const passed = { ...LED, currentTurnIndex: 3, passCount: 1 };

  it('when the viewer passes, and not when another seat does', async () => {
    const r = await render(table(LED, 0));
    expect(floats()).toBe(0);
    await r.rerender(table(passed, 0));
    expect(floats()).toBe(1);
    await r.unmount();

    const other = await render(table(LED, 2));
    await other.rerender(table(passed, 2));
    expect(floats()).toBe(0);
    await other.unmount();
  });

  it('not for a spectator, and not for a table that opens with the pass already made', async () => {
    const r = await render(table(LED, 0, true));
    await r.rerender(table(passed, 0, true));
    expect(floats()).toBe(0);
    await r.unmount();

    const resumed = await render(table(passed, 0));
    expect(floats()).toBe(0);
    await resumed.unmount();
  });

  it('when the viewer’s pass is the one that closes the round', async () => {
    const lastToAnswer = { ...LED, currentTurnIndex: 2, passCount: 2 };
    const closed = { ...LED, currentTurnIndex: 1, passCount: 0, lastPlayedCombination: null, roundWinner: 1 };
    const r = await render(table(lastToAnswer, 2));
    await r.rerender(table(closed, 2));
    expect(floats()).toBe(1);
    await r.unmount();
  });
});
