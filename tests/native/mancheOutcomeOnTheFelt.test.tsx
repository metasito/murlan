// tests/native/mancheOutcomeOnTheFelt.test.tsx — each manche outcome's moment on the felt, through GameTable's own wiring (#1469).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { Combination, GameState, Player } from '@/lib/game/gameEngine';
import * as feedback from '@/lib/device/feedback';
import * as particles from '@/components/table/particles';
import * as flightPhysics from '@/components/flightPhysics';
import { lampControls, type Pool } from '@/components/table/lampRig';
import { MancheMoment } from '@/lib/tokens';
import { bootFeedback, settle } from './helpers/feedback';
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
const CASES: { outcome: Outcome; teams: boolean; rankings: string[]; motes: number }[] = [
  { outcome: 'won', teams: false, rankings: ['player_0', 'player_1', 'player_2', 'player_3'], motes: MancheMoment.motes.won },
  { outcome: 'lost', teams: false, rankings: ['player_1', 'player_2', 'player_3', 'player_0'], motes: MancheMoment.motes.lost },
  { outcome: 'neutral', teams: false, rankings: ['player_1', 'player_0', 'player_2', 'player_3'], motes: MancheMoment.motes.lost },
  { outcome: 'draw', teams: true, rankings: ['player_0', 'player_1', 'player_2', 'player_3'], motes: 0 },
];

const seat = (i: number, teams: boolean): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [],
  type: 'human',
  ...(teams ? { team: i === 0 || i === 3 ? 'A' : 'B' } : {}),
});

const table = ({ teams, rankings }: (typeof CASES)[number], over: boolean, scored = over) => {
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
  const handScores = scored ? Object.fromEntries(rankings.map((id, i) => [id, 3 - i])) : {};
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={state} handScores={handScores} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
    </SafeAreaProvider>
  );
};

const lit = (r: RenderResult) => r.queryAllByTestId('pile-card-lit', { includeHiddenElements: true }).length;

async function closeManche(c: (typeof CASES)[number]) {
  const target = jest.spyOn(lampControls, 'setTarget');
  const r = await render(table(c, false));
  await settle(2000);
  await bootFeedback();
  const motes = jest.spyOn(particles, 'mancheMotes');
  const trauma = jest.spyOn(flightPhysics, 'traumaFor');
  const level = jest.spyOn(lampControls, 'setLevel');
  const sent = jest.spyOn(feedback, 'event');
  const aimBefore = target.mock.calls.at(-1)?.[1] as Pool | undefined;
  target.mockClear();
  await act(async () => r.rerender(table(c, true)));
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  const motesBeforeLanding = motes.mock.calls.length;
  const litBeforeLanding = lit(r);
  await settle(1500);
  return { r, motes, trauma, target, level, sent, aimBefore, motesBeforeLanding, litBeforeLanding };
}

describe("a manche's outcome on the felt", () => {
  beforeEach(async () => {
    mockReduceMotion = false;
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(CASES)('$outcome: $motes motes at the winner once the last card lands', async (c) => {
    const { r, motes, motesBeforeLanding } = await closeManche(c);
    expect(motesBeforeLanding).toBe(0);
    expect(motes.mock.calls.map(([o]) => o)).toEqual([c.outcome]);
    expect((motes.mock.results[0].value as unknown[]).length).toBe(c.motes);
    await r.unmount();
  });

  it.each(CASES)('$outcome: the table shakes only for a win', async (c) => {
    const { r, trauma } = await closeManche(c);
    const tiers = trauma.mock.calls.map(([tier]) => tier);
    expect(tiers).toContain(c.outcome === 'won' ? 'mancheWon' : 'ordinary');
    expect(tiers.includes('mancheWon')).toBe(c.outcome === 'won');
    await r.unmount();
  });

  it.each(CASES)('$outcome: the top card is lit only for a win, from the landing until the next deal', async (c) => {
    const { r, litBeforeLanding } = await closeManche(c);
    expect(litBeforeLanding).toBe(0);
    expect(lit(r)).toBe(c.outcome === 'won' ? 1 : 0);
    await act(async () => r.rerender(table(c, false)));
    await settle(100);
    expect(lit(r)).toBe(0);
    await r.unmount();
  });

  it.each(CASES)('$outcome: the lamp turns to the winner for a loss or a neutral finish, and dims only for a loss', async (c) => {
    const { r, target, level, aimBefore } = await closeManche(c);
    const turns = c.outcome === 'lost' || c.outcome === 'neutral';
    const aimAfter = target.mock.calls.at(-1)?.[1] ?? aimBefore;
    expect(aimBefore).toBeDefined();
    expect(aimAfter?.slice(0, 2)).not.toEqual(turns ? aimBefore!.slice(0, 2) : undefined);
    if (!turns) expect(target.mock.calls.every(([, pool]) => pool[0] === aimBefore![0] && pool[1] === aimBefore![1])).toBe(true);
    const dims = level.mock.calls.filter(([, to, rate]) => to === MancheMoment.lostLevel && rate === MancheMoment.lostLevelRate);
    expect(dims.length > 0).toBe(c.outcome === 'lost');

    level.mockClear();
    await act(async () => r.rerender(table(c, false)));
    await settle(100);
    const released = level.mock.calls.some(([, to, rate]) => to === 1 && rate === MancheMoment.releaseRate);
    expect(released).toBe(c.outcome === 'lost');
    expect((target.mock.calls.at(-1)?.[1] ?? aimBefore!).slice(0, 2)).toEqual(aimBefore!.slice(0, 2));
    await r.unmount();
  });

  // Online, a teams manche's scores (`game:over`) trail the state that ends it: the outcome is pending until they come.
  describe('a teams win scored after the throw', () => {
    const TEAMS_WON = { outcome: 'won' as const, teams: true, rankings: ['player_0', 'player_3', 'player_1', 'player_2'], motes: MancheMoment.motes.won };

    async function scoredAfter(ms: number) {
      const r = await render(table(TEAMS_WON, false));
      await settle(2000);
      await bootFeedback();
      const motes = jest.spyOn(particles, 'mancheMotes');
      const trauma = jest.spyOn(flightPhysics, 'traumaFor');
      await act(async () => r.rerender(table(TEAMS_WON, true, false)));
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
      const motesUnscored = motes.mock.calls.length;
      await act(async () => r.rerender(table(TEAMS_WON, true, true)));
      await settle(1500);
      return { r, motes, trauma, motesUnscored };
    }

    it('scored while the card flies: it lands as the win, shaking', async () => {
      const { r, motes, trauma, motesUnscored } = await scoredAfter(16);
      expect(motesUnscored).toBe(0);
      expect(trauma.mock.calls.map(([tier]) => tier)).toContain('mancheWon');
      expect(motes.mock.calls.map(([o]) => o)).toEqual(['won']);
      expect(lit(r)).toBe(1);
      await r.unmount();
    });

    it('scored after it landed: the motes and the lit card wait for the score, and the landing that passed does not shake', async () => {
      const { r, motes, trauma, motesUnscored } = await scoredAfter(1500);
      expect(motesUnscored).toBe(0);
      expect(trauma.mock.calls.map(([tier]) => tier)).not.toContain('mancheWon');
      expect(motes.mock.calls.map(([o]) => o)).toEqual(['won']);
      expect(lit(r)).toBe(1);
      await r.unmount();
    });
  });

  it.each(CASES)('$outcome under reduced motion: no motes and no shake, and the sting still plays', async (c) => {
    mockReduceMotion = true;
    const { r, motes, trauma, sent } = await closeManche(c);
    expect(motes.mock.results.every(({ value }) => (value as unknown[]).length === 0)).toBe(true);
    expect(trauma.mock.results.every(({ value }) => value === 0)).toBe(true);
    expect(sent.mock.calls.some(([ms]) => ms.some((m) => m.kind === 'mancheOver'))).toBe(true);
    await r.unmount();
  });
});
