// tests/native/mancheStingAtLanding.test.tsx — a manche's sting sounds 300 ms after the landing that ends it (#1420).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { Combination, GameState, Player } from '@/lib/game/gameEngine';
import * as feedback from '@/lib/device/feedback';
import { LATE_SOUND_MS } from '@/lib/tokens';
import { bootFeedback, settle, sounds } from './helpers/feedback';
import { card, PAIR } from './helpers/landing';

let mockReduceMotion = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
  setMotionPreference: () => {},
  getMotionPreference: () => 'system',
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};
const LAST: Combination = { type: 'pair', cards: [card('k1', 'K', 'clubs'), card('k2', 'K', 'diamonds')], strength: 13 };

type Outcome = 'won' | 'lost' | 'neutral' | 'draw';
const CASES: { outcome: Outcome; sting: string; teams: boolean; rankings: string[] }[] = [
  { outcome: 'won', sting: 'mancheWon', teams: false, rankings: ['player_0', 'player_1', 'player_2', 'player_3'] },
  { outcome: 'lost', sting: 'mancheLost', teams: false, rankings: ['player_1', 'player_2', 'player_3', 'player_0'] },
  { outcome: 'neutral', sting: 'mancheNeutral', teams: false, rankings: ['player_1', 'player_0', 'player_2', 'player_3'] },
  { outcome: 'draw', sting: 'mancheNeutral', teams: true, rankings: ['player_0', 'player_1', 'player_2', 'player_3'] },
];

const seat = (i: number, teams: boolean): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [],
  type: 'human',
  ...(teams ? { team: i === 0 || i === 3 ? 'A' : 'B' } : {}),
});

const table = ({ teams, rankings }: (typeof CASES)[number], over: boolean) => {
  const state: GameState = {
    players: [0, 1, 2, 3].map((i) => seat(i, teams)),
    currentTurnIndex: 3,
    lastPlayedCombination: over ? LAST : PAIR,
    lastPlayedBy: over ? 3 : 2,
    passCount: 0,
    gameMode: teams ? 'teams' : 'free_for_all',
    roundWinner: null,
    gameOver: over,
    rankings: over ? rankings : [],
    firstPlayMade: true,
  };
  const handScores = over ? Object.fromEntries(rankings.map((id, i) => [id, 3 - i])) : {};
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={state} handScores={handScores} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
    </SafeAreaProvider>
  );
};

async function stingAfterLanding(c: (typeof CASES)[number]) {
  const r = await render(table(c, false));
  await settle(2000);
  await bootFeedback();
  const sent = jest.spyOn(feedback, 'event');
  await act(async () => r.rerender(table(c, true)));
  await settle(3000);
  const atOf = (kind: string) => sent.mock.calls.filter(([ms]) => ms.some((m) => m.kind === kind)).map(([, at]) => at!);
  const [landed] = atOf('landing');
  const stings = atOf('mancheOver');
  const heard = sounds();
  sent.mockRestore();
  await r.unmount();
  return { heard, landed, stings };
}

describe('the manche sting', () => {
  beforeEach(async () => {
    mockReduceMotion = false;
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(CASES)('$outcome: $sting sounds 300 ms after the last card lands', async (c) => {
    const { heard, landed, stings } = await stingAfterLanding(c);
    expect(heard).toEqual(['combo', c.sting]);
    expect(stings).toEqual([landed + 300]);
  });

  it.each(CASES)('$outcome under reduced motion: $sting still sounds 300 ms after the landing', async (c) => {
    mockReduceMotion = true;
    const { heard, landed, stings } = await stingAfterLanding(c);
    expect(heard).toEqual(['combo', c.sting]);
    expect(stings).toHaveLength(1);
    expect(stings[0] - landed).toBeGreaterThan(300 - LATE_SOUND_MS);
    expect(stings[0] - landed).toBeLessThanOrEqual(300);
  });
});
