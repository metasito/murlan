import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnimatedStyle } from 'react-native-reanimated';

jest.mock('@/lib/sounds', () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playYourTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playUrgentTick: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playGameWin: jest.fn(async () => {}),
  playGameLose: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  holdSounds: jest.fn(() => () => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

import { GameTable } from '@/components/GameTable';
import { impactDelayMs } from '@/components/flightPhysics';
import { setMotionPreference } from '@/lib/accessibility';
import { setScreenShakeEnabled } from '@/lib/screenShake';
import type { Card, Combination, GameState, Player } from '@/lib/gameEngine';

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
      selectedIds={[]}
      onSelectCard={noop}
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

  it('rises toward 0.25 across the flight and is gone at the impact', async () => {
    const r = await render(table(stateAfter(BOMB)));
    await advance(impactDelayMs(false) * 0.8);
    const mid = scrimOpacity();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.25);

    await advance(impactDelayMs(false) * 0.2 - 2);
    expect(scrimDarkness()).toBeGreaterThan(0.24);
    expect(scrimDarkness()).toBeLessThanOrEqual(0.25);

    await advance(3);
    expect(scrimOpacity()).toBe(0);
    await r.unmount();
  });

  it('stays dark for a play that is not a bomb', async () => {
    const r = await render(table(stateAfter(SINGLE)));
    await advance(impactDelayMs(false) * 0.8);
    expect(scrimOpacity()).toBe(0);
    await r.unmount();
  });

  it('with screen shake off, the bomb still flies and still throws its sparks', async () => {
    setScreenShakeEnabled(false);
    const r = await render(table(stateAfter(BOMB)));
    expect(screen.getByTestId('flying-cards')).toBeTruthy();
    await advance(impactDelayMs(false) + 1);
    await advance(90);
    expect((getAnimatedStyle(screen.getByTestId('spark-0')) as { opacity?: number }).opacity).toBeGreaterThan(0);
    await r.unmount();
  });

  it('stays out under reduced motion', async () => {
    setMotionPreference('on');
    const r = await render(table(stateAfter(BOMB)));
    await advance(impactDelayMs(true) * 0.8);
    expect(scrimOpacity()).toBe(0);
    await r.unmount();
  });
});
