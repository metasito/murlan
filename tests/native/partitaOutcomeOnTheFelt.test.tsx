// tests/native/partitaOutcomeOnTheFelt.test.tsx — a partita's outcome on the felt, through GameTable's own wiring (#1423).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { Combination, GameState, Player } from '@/lib/game/gameEngine';
import * as feedback from '@/lib/device/feedback';
import * as particles from '@/components/table/particles';
import * as coneRain from '@/components/table/coneRain';
import * as flightPhysics from '@/components/flightPhysics';
import { lampControls, type Pool } from '@/components/table/lampRig';
import { MancheMoment } from '@/lib/tokens';
import { bootFeedback, haptics, settle } from './helpers/feedback';
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
const RANKINGS = ['player_1', 'player_2', 'player_3', 'player_0'];

interface Case {
  name: string;
  outcome: 'won' | 'lost' | 'draw';
  teams: boolean;
  winners: string[];
  closer: number;
}
// Seat 0 is the viewer, seat 2 sits opposite; in teams seats 0 and 3 are side A.
const CASES: Case[] = [
  { name: 'won, an opponent closing', outcome: 'won', teams: false, winners: ['player_0'], closer: 3 },
  { name: 'won, the viewer closing', outcome: 'won', teams: false, winners: ['player_0'], closer: 0 },
  { name: 'won by the partner in teams', outcome: 'won', teams: true, winners: ['player_3', 'player_0'], closer: 3 },
  { name: 'lost, the viewer closing', outcome: 'lost', teams: false, winners: ['player_2'], closer: 0 },
  { name: 'lost, an opponent closing', outcome: 'lost', teams: false, winners: ['player_2'], closer: 3 },
];

const seat = (i: number, teams: boolean): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [],
  type: 'human',
  ...(teams ? { team: i === 0 || i === 3 ? 'A' : 'B' } : {}),
});

const table = (c: Case, over: boolean, decided = over) => {
  const state: GameState = {
    players: [0, 1, 2, 3].map((i) => seat(i, c.teams)),
    currentTurnIndex: c.closer,
    lastPlayedCombination: over ? LAST : PAIR,
    lastPlayedBy: over ? c.closer : (c.closer + 3) % 4,
    passCount: 0,
    gameMode: c.teams ? 'teams' : 'free_for_all',
    roundWinner: null,
    gameOver: over,
    rankings: over ? RANKINGS : [],
    firstPlayMade: true,
  };
  const handScores = decided ? Object.fromEntries(RANKINGS.map((id, i) => [id, 3 - i])) : {};
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable
        gameState={state}
        handScores={handScores}
        matchOver={decided}
        matchWinners={decided ? c.winners : []}
        viewerSeat={0}
        onPlay={noop}
        onPass={noop}
        onQuit={noop}
        onExchangeGive={noop}
      />
    </SafeAreaProvider>
  );
};

async function closePartita(c: Case) {
  const target = jest.spyOn(lampControls, 'setTarget');
  const r = await render(table(c, false));
  await settle(2000);
  await bootFeedback();
  const motes = jest.spyOn(particles, 'mancheMotes');
  const rain = jest.spyOn(coneRain, 'startRain');
  const trauma = jest.spyOn(flightPhysics, 'traumaFor');
  const level = jest.spyOn(lampControls, 'setLevel');
  const sent = jest.spyOn(feedback, 'event');
  const aimBefore = target.mock.calls.at(-1)?.[1] as Pool | undefined;
  target.mockClear();
  const tapsBefore = haptics().length;
  await act(async () => r.rerender(table(c, true)));
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  const motesBeforeLanding = motes.mock.calls.length;
  await settle(1500);
  const atOf = (kind: string) => sent.mock.calls.filter(([ms]) => ms.some((m) => m.kind === kind)).map(([, at]) => at!);
  return {
    r, motes, rain, trauma, target, level, aimBefore, motesBeforeLanding,
    landed: atOf('landing')[0],
    stings: atOf('partitaOver'),
    taps: haptics().slice(tapsBefore),
  };
}

describe("a partita's outcome on the felt", () => {
  beforeEach(async () => {
    mockReduceMotion = false;
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(CASES)('$name: the sting is placed 300 ms after the last card lands', async (c) => {
    const { r, landed, stings } = await closePartita(c);
    expect(stings).toEqual([landed + 300]);
    await r.unmount();
  });

  it.each(CASES)('$name: one medium tap on the contact, then the outcome\'s, and no landing pulse of its own', async (c) => {
    const { r, taps } = await closePartita(c);
    expect(taps).toEqual(['impactMedium', c.outcome === 'won' ? 'notificationSuccess' : 'notificationWarning']);
    await r.unmount();
  });

  it.each(CASES)('$name: motes at the winner once the last card lands, and rain through the cone only for a win', async (c) => {
    const { r, motes, rain, motesBeforeLanding } = await closePartita(c);
    expect(motesBeforeLanding).toBe(0);
    expect(motes.mock.calls.map(([o]) => o)).toEqual([c.outcome]);
    expect((motes.mock.results[0].value as unknown[]).length).toBe(c.outcome === 'won' ? MancheMoment.motes.won : MancheMoment.motes.lost);
    const at = motes.mock.calls[0][1];
    // The viewer's seat is at the bottom, the losing cases' winner opposite at the top.
    if (c.outcome === 'won') expect(at.y).toBeGreaterThan(METRICS.frame.height / 2);
    else expect(at.y).toBeLessThan(METRICS.frame.height / 2);
    expect(rain).toHaveBeenCalledTimes(c.outcome === 'won' ? 1 : 0);
    await r.unmount();
  });

  it.each(CASES)('$name: the table shakes only for a win', async (c) => {
    const { r, trauma } = await closePartita(c);
    const tiers = trauma.mock.calls.map(([tier]) => tier);
    expect(tiers.includes('partitaWon')).toBe(c.outcome === 'won');
    expect(tiers.includes('mancheWon')).toBe(false);
    await r.unmount();
  });

  it.each(CASES)('$name: the lamp turns to the winner and dims only for a loss', async (c) => {
    const { r, target, level, aimBefore } = await closePartita(c);
    expect(aimBefore).toBeDefined();
    const moved = target.mock.calls.some(([, pool]) => pool[0] !== aimBefore![0] || pool[1] !== aimBefore![1]);
    expect(moved).toBe(c.outcome === 'lost');
    const dims = level.mock.calls.filter(([, to, rate]) => to === MancheMoment.lostLevel && rate === MancheMoment.lostLevelRate);
    expect(dims.length > 0).toBe(c.outcome === 'lost');
    await r.unmount();
  });

  it.each<Case>([
    { name: 'drawn, the viewer listed first', outcome: 'draw', teams: false, winners: ['player_0', 'player_2'], closer: 3 },
    { name: 'drawn, the viewer listed second', outcome: 'draw', teams: false, winners: ['player_2', 'player_0'], closer: 3 },
  ])('$name: a co-winner gets neither the win nor the loss on the felt', async (c) => {
    const { r, motes, rain, trauma, level } = await closePartita(c);
    expect(motes.mock.calls.map(([o]) => o)).toEqual(['draw']);
    expect(rain).not.toHaveBeenCalled();
    expect(trauma.mock.calls.map(([tier]) => tier)).not.toContain('partitaWon');
    expect(level.mock.calls.some(([, to]) => to === MancheMoment.lostLevel)).toBe(false);
    await r.unmount();
  });

  // Online, the scores and `matchOver` come after the state that ends the manche.
  it('the partita decided while the viewer\'s last card flies: its landing still pulses nothing of its own', async () => {
    const c = CASES[1];
    const r = await render(table(c, false));
    await settle(2000);
    await bootFeedback();
    const tapsBefore = haptics().length;
    await act(async () => r.rerender(table(c, true, false)));
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    await act(async () => r.rerender(table(c, true, true)));
    await settle(1500);
    expect(haptics().slice(tapsBefore)).toEqual(['impactMedium', 'notificationSuccess']);
    await r.unmount();
  });

  it.each(CASES)('$name under reduced motion: no motes, no rain and no shake, while the sting still plays 300 ms after the landing', async (c) => {
    mockReduceMotion = true;
    const { r, motes, rain, trauma, landed, stings } = await closePartita(c);
    expect(motes.mock.results.every(({ value }) => (value as unknown[]).length === 0)).toBe(true);
    expect(rain).not.toHaveBeenCalled();
    expect(trauma.mock.results.every(({ value }) => value === 0)).toBe(true);
    expect(stings).toHaveLength(1);
    expect(stings[0] - landed).toBeLessThanOrEqual(300);
    expect(stings[0] - landed).toBeGreaterThan(0);
    await r.unmount();
  });
});
