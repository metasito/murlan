// tests/native/mancheEndingPill.test.tsx — the score pill's payoff at the end of a manche: it
// counts the viewer's gain in on its own clock, a tap jumps it to the settled pill, and reduced
// motion starts it there, its glow still fading over its own length under the app's reduced root.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ReduceMotion, ReducedMotionConfig, getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import { setMotionPreference } from '@/lib/accessibility';
import { mancheEndingOnsets } from '@/lib/game/mancheEnding';
import type { GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};
const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const seat = (i: number): Player => ({ id: `player_${i}`, name: `P${i}`, hand: [], type: i === 0 ? 'human' : 'ai' });
const ENDED: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: true,
  rankings: ['player_0', 'player_1', 'player_2', 'player_3'],
  firstPlayMade: true,
};
const BEFORE = 7;
const AFTER = 10;
const { gains, settled } = mancheEndingOnsets(4);

function table(onMancheLanded: (at: number) => void) {
  return (
    <>
      <ReducedMotionConfig mode={ReduceMotion.Always} />
      <SafeAreaProvider initialMetrics={METRICS}>
        <GameTable
          gameState={ENDED}
          viewerSeat={0}
          handScores={{ player_0: AFTER - BEFORE, player_1: 1, player_2: 0, player_3: 0 }}
          matchScore={{ scores: { player_0: AFTER, player_1: 4, player_2: 2, player_3: 1 }, target: 21 }}
          onPlay={noop}
          onPass={noop}
          onQuit={noop}
          onExchangeGive={noop}
          onMancheLanded={onMancheLanded}
        />
      </SafeAreaProvider>
    </>
  );
}
const HIDDEN = { includeHiddenElements: true };
const shownTotal = () => Number(screen.getByTestId('score-pill-total', HIDDEN).props.children[0]);
const glow = () => Number(getAnimatedStyle(screen.getByTestId('score-pill-glow', HIDDEN)).opacity);

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  setMotionPreference('system');
});

describe('the score pill at the end of a manche', () => {
  it('counts the viewer gain in at its onset, and a tap jumps to the settled pill', async () => {
    const landed = jest.fn();
    const view = await render(table(landed));
    await advance(0);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(shownTotal()).toBe(BEFORE);

    await advance(gains[0] - 100);
    expect(shownTotal()).toBe(BEFORE);
    await fireEvent(screen.getByTestId('pile-area', HIDDEN), 'startShouldSetResponderCapture', { nativeEvent: { pageX: 0, pageY: 0 } });
    await advance(16);
    expect(shownTotal()).toBe(AFTER);
    expect(glow()).toBeGreaterThan(0.9);
    expect(landed).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('counts in without a tap by the time the pill has settled', async () => {
    const view = await render(table(noop));
    await advance(settled);
    expect(shownTotal()).toBe(AFTER);
    await view.unmount();
  });

  it('under reduced motion starts settled, and its glow still fades over its length', async () => {
    setMotionPreference('on');
    const view = await render(table(noop));
    await advance(16);
    expect(shownTotal()).toBe(AFTER);
    await advance(450);
    expect(glow()).toBeGreaterThan(0.2);
    expect(glow()).toBeLessThan(0.8);
    await view.unmount();
  });
});
