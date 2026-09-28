import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { GameState } from '@/lib/game/gameEngine';
import { bootFeedback, effects, settle } from './helpers/feedback';
import { botManche as manche, STEP_MS } from './helpers/botManche';

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};

export function pileUps(starts: number[], windowS: number): number[][] {
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.flatMap((t, i) => (i > 0 && t - sorted[i - 1] < windowS ? [[sorted[i - 1], t]] : []));
}

const table = (s: GameState) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <GameTable gameState={s} viewerSeat={0} selectedIds={[]} onSelectCard={noop} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} />
  </SafeAreaProvider>
);

describe('one table state change sounds one thing', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('the checker flags two starts inside the window and not two outside it', () => {
    expect(pileUps([10, 10.03, 11], 0.05)).toEqual([[10, 10.03]]);
    expect(pileUps([10, 10.2], 0.05)).toEqual([]);
  });

  it('a whole bot manche never starts two effects within 50 ms', async () => {
    const states = manche();
    const r = await render(table(states[0]));
    for (const s of states.slice(1)) {
      await act(async () => r.rerender(table(s)));
      await settle(STEP_MS);
    }
    const starts = effects().map((n) => n.startedAt!);
    expect(starts.length).toBeGreaterThanOrEqual(6);
    expect(pileUps(starts, 0.05)).toEqual([]);
    await r.unmount();
  });
});
