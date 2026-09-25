// tests/native/landingDust.test.tsx — the card landing (#1258): on the landing onset the table
// throws `landDust` into its one particle layer around the pile's centre, and traces the onset;
// under reduced motion only the onset.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React, { type Ref } from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockEmit = jest.fn<(spawns: readonly ParticleSpawn[]) => void>();
const mockTraceOnset = jest.fn();
const mockMotion = { reduced: false };

jest.mock('@/components/table/particleLayer', () => ({
  ParticleLayer: ({ ref }: { ref: Ref<ParticleEmitter> }) => {
    (require('react') as typeof React).useImperativeHandle(ref, () => ({ emit: mockEmit }));
    return null;
  },
}));
jest.mock('@/lib/e2eTrace', () => ({
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
  useTraceSource: () => {},
}));
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockMotion.reduced,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockMotion.reduced ? 'on' : 'off'),
}));
jest.mock('@/lib/device/sounds', () => ({
  ensureAudioMode: jest.fn(async () => {}),
  playCardSelect: jest.fn(async () => {}),
  playCardPlay: jest.fn(async () => {}),
  playCombo: jest.fn(async () => {}),
  playCardPass: jest.fn(async () => {}),
  playTurn: jest.fn(async () => {}),
  playRoundStart: jest.fn(async () => {}),
  playRoundWin: jest.fn(async () => {}),
  playClockRunningOut: jest.fn(async () => {}),
  stopClockRunningOut: jest.fn(async () => {}),
  playBomb: jest.fn(async () => {}),
  playMancheWon: jest.fn(async () => {}),
  playMancheLost: jest.fn(async () => {}),
  playDeal: jest.fn(async () => {}),
  playExchange: jest.fn(async () => {}),
  preloadSounds: jest.fn(async () => {}),
  holdSounds: jest.fn(() => () => {}),
  setSoundsMasterEnabled: jest.fn(() => {}),
  setSoundsMasterVolume: jest.fn(() => {}),
}));

import { GameTable } from '@/components/GameTable';
import { impactDelayMs } from '@/components/flightPhysics';
import type { Card, Combination, GameState, Player } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const card = (id: string, rank: Card['rank'], suit: Card['suit']): Card => ({ id, rank, suit, isJoker: false });
const seat = (i: number): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: Array.from({ length: 5 }, (_, k) => card(`s${i}_${k}`, '3', 'spades')),
  type: 'human',
});
const PAIR: Combination = { type: 'pair', cards: [card('a', '5', 'clubs'), card('b', '5', 'diamonds')], strength: 5 };
const state: GameState = {
  players: [0, 1, 2, 3].map(seat),
  currentTurnIndex: 0,
  lastPlayedCombination: PAIR,
  lastPlayedBy: 3,
  passCount: 0,
  gameMode: 'free_for_all',
  roundWinner: null,
  gameOver: false,
  rankings: [],
  firstPlayMade: true,
};
const noop = () => {};

async function throwPair() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={state}
        viewerSeat={0}
        selectedIds={[]}
        onSelectCard={noop}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
      />
    </SafeAreaProvider>
  );
}

const landings = () => mockTraceOnset.mock.calls.filter(([kind, name]) => kind === 'moment' && name === 'landing');

describe('the card landing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    mockMotion.reduced = false;
  });

  it('throws 16 + 5n dust and three puffs around the pile on the landing onset, not before', async () => {
    const view = await throwPair();
    await act(async () => {
      jest.advanceTimersByTime(impactDelayMs(false) - 10);
    });
    expect(mockEmit).not.toHaveBeenCalled();
    expect(landings()).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(20);
      jest.runOnlyPendingTimers();
    });
    expect(landings()).toHaveLength(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const spawns = mockEmit.mock.calls[0][0];
    expect(spawns.filter((p) => p.shape !== 'soft')).toHaveLength(16 + 5 * 2);
    expect(spawns.filter((p) => p.shape === 'soft')).toHaveLength(3);
    // The dust spreads over 30n + 40 table points around the pile's centre, which sits midway
    // between the table's edges — nowhere near the felt's origin.
    const xs = spawns.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(100);
    expect(Math.min(...xs)).toBeGreaterThan(300);
    expect(Math.max(...xs)).toBeLessThan(560);
    await view.unmount();
  });

  it('under reduced motion traces the onset and throws no dust', async () => {
    mockMotion.reduced = true;
    const view = await throwPair();
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(landings()).toHaveLength(1);
    expect(mockEmit).not.toHaveBeenCalled();
    await view.unmount();
  });
});
