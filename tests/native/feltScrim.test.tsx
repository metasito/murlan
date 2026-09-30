import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

import { GameTable } from '@/components/GameTable';
import { farthest, frameOfFirst } from './helpers/landing';
import { setMotionPreference } from '@/lib/accessibility';
import { setScreenShakeEnabled } from '@/lib/screenShake';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};

const seat = (id: string, name: string, hand: Card[]): Player => ({ id, name, hand, type: 'human' });
const card = (suit: Card['suit']): Card => ({ id: `9_${suit}`, rank: '9', suit, isJoker: false });
const KEEP: Card = { id: '3_clubs', rank: '3', suit: 'clubs', isJoker: false };
const BOMB: Combination = {
  type: 'bomb',
  cards: [card('hearts'), card('spades'), card('diamonds'), card('clubs')],
  strength: 9,
};
const SINGLE: Combination = { type: 'single', cards: [card('hearts')], strength: 9 };

const stateAfter = (play: Combination): GameState => ({
  players: [seat('player_0', 'Ana', [KEEP]), seat('player_1', 'Besi', [KEEP])],
  currentTurnIndex: 1,
  lastPlayedCombination: play,
  lastPlayedBy: 0,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
});

const noop = () => {};
const table = (gameState: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable
      gameState={gameState}
      viewerSeat={1}
      onPlay={noop}
      onPass={noop}
      onQuit={noop}
      onExchangeGive={noop}
    />
  </SafeAreaProvider>
);

const scrimOpacity = () => (getAnimatedStyle(screen.getByTestId('felt-scrim', { includeHiddenElements: true })) as { opacity?: number }).opacity ?? 0;
const scrimDarkness = () => {
  const { backgroundColor } = StyleSheet.flatten(screen.getByTestId('felt-scrim', { includeHiddenElements: true }).props.style);
  const alpha = Number(/rgba\((?:[^,]+,){3}\s*([\d.]+)\)/.exec(String(backgroundColor))?.[1] ?? 1);
  return alpha * scrimOpacity();
};

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('the felt dims before a bomb lands', () => {
  beforeEach(() => {
    setMotionPreference('off');
    jest.useFakeTimers();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await act(async () => setMotionPreference('system'));
    await act(async () => setScreenShakeEnabled(true));
  });

  it('rises toward 0.25 across the flight and is gone on the contact frame', async () => {
    const r = await render(table(stateAfter(BOMB)));
    const dark: number[] = [];
    const { frame, drawn } = await frameOfFirst(r, () => {
      dark.push(scrimDarkness());
      return dark.length > 1 && dark.at(-1) === 0 && dark.at(-2)! > 0;
    });
    expect(drawn[frame]).toBeLessThanOrEqual(1);
    expect(drawn[frame - 1]).toBeGreaterThan(1);
    expect(dark.some((d) => d > 0 && d < 0.2)).toBe(true);
    expect(dark[frame - 1]).toBeGreaterThan(0.2);
    expect(Math.max(...dark)).toBeLessThanOrEqual(0.25);
    await r.unmount();
  });

  it('stays dark for a play that is not a bomb', async () => {
    const r = await render(table(stateAfter(SINGLE)));
    const seen: number[] = [];
    await frameOfFirst(r, () => {
      seen.push(scrimOpacity());
      return farthest(r) <= 1;
    });
    expect(Math.max(...seen)).toBe(0);
    await r.unmount();
  });

  it('with screen shake off, the bomb still flies and still throws its sparks', async () => {
    setScreenShakeEnabled(false);
    const r = await render(table(stateAfter(BOMB)));
    expect(screen.getByTestId('flying-cards', { includeHiddenElements: true })).toBeTruthy();
    await frameOfFirst(r, () => farthest(r) <= 1);
    await advance(90);
    expect((getAnimatedStyle(screen.getByTestId('spark-0', { includeHiddenElements: true })) as { opacity?: number }).opacity).toBeGreaterThan(0);
    await r.unmount();
  });

  it('stays out under reduced motion', async () => {
    setMotionPreference('on');
    const r = await render(table(stateAfter(BOMB)));
    await advance(48);
    expect(scrimOpacity()).toBe(0);
    await r.unmount();
  });
});
