// tests/native/roundOutcomeOnTheFelt.test.tsx — each round outcome's moment on the felt, through GameTable's own wiring (#1469).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';
import { act, render, within, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GameTable } from '@/components/GameTable';
import type { Combination, GameState, Player } from '@/lib/game/gameEngine';
import * as feedback from '@/lib/device/feedback';
import * as particles from '@/components/table/particles';
import * as impact from '@/components/impact';
import { lampControls, type Pool } from '@/components/table/lampRig';
import { RoundMoment } from '@/lib/tokens';
import { bootFeedback, settle } from './helpers/feedback';
import { card, PAIR } from './helpers/landing';
import { setMotion } from './harness/env';
import { emptyRankTally } from '@/lib/game/gameEngine';

const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};
const LAST: Combination = { type: 'pair', cards: [card('k1', 'K', 'clubs'), card('k2', 'K', 'diamonds')], strength: 13 };

type Outcome = 'won' | 'lost' | 'neutral' | 'draw';
const CASES: { outcome: Outcome; teams: boolean; finishingOrder: string[]; motes: number }[] = [
  { outcome: 'won', teams: false, finishingOrder: ['player_0', 'player_1', 'player_2', 'player_3'], motes: RoundMoment.motes.won },
  { outcome: 'won', teams: true, finishingOrder: ['player_0', 'player_3', 'player_1', 'player_2'], motes: RoundMoment.motes.won },
  { outcome: 'lost', teams: false, finishingOrder: ['player_1', 'player_2', 'player_3', 'player_0'], motes: RoundMoment.motes.lost },
  { outcome: 'neutral', teams: false, finishingOrder: ['player_1', 'player_0', 'player_2', 'player_3'], motes: RoundMoment.motes.lost },
  { outcome: 'draw', teams: true, finishingOrder: ['player_0', 'player_1', 'player_2', 'player_3'], motes: 0 },
];

const seat = (i: number, teams: boolean): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [],
  type: 'human',
  ...(teams ? { team: i === 0 || i === 3 ? 'A' : 'B' } : {}),
});

const table = ({ teams, finishingOrder }: (typeof CASES)[number], over: boolean, scored = over) => {
  const state: GameState = {
    players: [0, 1, 2, 3].map((i) => seat(i, teams)),
    currentTurnIndex: 3,
    lastPlayedCombination: over ? LAST : PAIR,
    lastPlayedBy: over ? 3 : 2,
    passCount: 0,
    gameMode: teams ? 'teams' : 'free_for_all',
    trickWinner: null,
    roundOver: over,
    finishingOrder: over ? finishingOrder : [],
    firstPlayMade: true,
    playedRanks: emptyRankTally(),
    lastMove: { seq: 0, kind: "deal" },
  };
  const placementPoints = scored ? Object.fromEntries(finishingOrder.map((id, i) => [id, 3 - i])) : {};
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={state} placementPoints={placementPoints} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} />
    </SafeAreaProvider>
  );
};

const lit = (r: RenderResult) => r.queryAllByTestId('pile-card-lit', { includeHiddenElements: true }).length;
const litSeats = (r: RenderResult) =>
  ['side-seat-left', 'top-seat', 'side-seat-right'].filter(
    (id) => within(r.getByTestId(id)).getByTestId('seat-ring').props.dataSet?.seatLit === 'true'
  );

async function closeRound(c: (typeof CASES)[number]) {
  const target = jest.spyOn(lampControls, 'setTarget');
  const r = await render(table(c, false));
  await settle(2000);
  await bootFeedback();
  const motes = jest.spyOn(particles, 'roundMotes');
  const trauma = jest.spyOn(impact, 'traumaFor');
  const level = jest.spyOn(lampControls, 'hold');
  const sent = jest.spyOn(feedback, 'event');
  const aimBefore = target.mock.calls.at(-1)?.[1] as Pool | undefined;
  target.mockClear();
  await act(async () => r.rerender(table(c, true)));
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  const motesBeforeLanding = motes.mock.calls.length;
  const litBeforeLanding = lit(r);
  const seatsBeforeLanding = litSeats(r);
  await settle(1500);
  return { r, motes, trauma, target, level, sent, aimBefore, motesBeforeLanding, litBeforeLanding, seatsBeforeLanding };
}

describe("a round's outcome on the felt", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // Seat 3 closes every case: the viewer's partner in teams, an opponent otherwise.
  it.each(CASES)(
    '$outcome (teams: $teams): once the last card lands, $motes motes at the winner, a shake only for a win, the closing seat off move, ' +
      'the closing card lit only for a win the winning team closed, the lamp turned to the winner for a loss or a neutral finish and dimmed only for a loss; ' +
      'the next deal puts out the card and gives the lamp back',
    async (c) => {
      const { r, motes, trauma, target, level, aimBefore, motesBeforeLanding, litBeforeLanding, seatsBeforeLanding } = await closeRound(c);

      expect(motesBeforeLanding).toBe(0);
      expect(motes.mock.calls.map(([o]) => o)).toEqual([c.outcome]);
      expect((motes.mock.results[0].value as unknown[]).length).toBe(c.motes);

      const tiers = trauma.mock.calls.map(([tier]) => tier);
      expect(tiers).toContain(c.outcome === 'won' ? 'roundWon' : 'ordinary');
      expect(tiers.includes('roundWon')).toBe(c.outcome === 'won');

      expect(seatsBeforeLanding).toEqual(['side-seat-left']);
      expect(litSeats(r)).toEqual([]);

      expect(litBeforeLanding).toBe(0);
      expect(lit(r)).toBe(c.outcome === 'won' && c.teams ? 1 : 0);

      const turns = c.outcome === 'lost' || c.outcome === 'neutral';
      const aimAfter = target.mock.calls.at(-1)?.[1] ?? aimBefore;
      expect(aimBefore).toBeDefined();
      expect(aimAfter?.slice(0, 2)).not.toEqual(turns ? aimBefore!.slice(0, 2) : undefined);
      if (!turns) expect(target.mock.calls.every(([, pool]) => pool[0] === aimBefore![0] && pool[1] === aimBefore![1])).toBe(true);
      const dims = level.mock.calls.filter(([, owner, to, rate]) => owner === 'lost' && to === RoundMoment.lostLevel && rate === RoundMoment.lostLevelRate);
      expect(dims.length > 0).toBe(c.outcome === 'lost');

      level.mockClear();
      await act(async () => r.rerender(table(c, false)));
      await settle(100);
      expect(lit(r)).toBe(0);
      const released = level.mock.calls.some(([, owner, to, rate]) => owner === 'lost' && to === null && rate === RoundMoment.releaseRate);
      expect(released).toBe(c.outcome === 'lost');
      expect((target.mock.calls.at(-1)?.[1] ?? aimBefore!).slice(0, 2)).toEqual(aimBefore!.slice(0, 2));
      await r.unmount();
    }
  );

  // Online, a teams round's scores (`game:round_over`) trail the state that ends it: the outcome is pending until they come.
  describe('a teams win scored after the throw', () => {
    const TEAMS_WON = { outcome: 'won' as const, teams: true, finishingOrder: ['player_0', 'player_3', 'player_1', 'player_2'], motes: RoundMoment.motes.won };

    async function scoredAfter(ms: number) {
      const r = await render(table(TEAMS_WON, false));
      await settle(2000);
      await bootFeedback();
      const motes = jest.spyOn(particles, 'roundMotes');
      const trauma = jest.spyOn(impact, 'traumaFor');
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
      expect(trauma.mock.calls.map(([tier]) => tier)).toContain('roundWon');
      expect(motes.mock.calls.map(([o]) => o)).toEqual(['won']);
      expect(lit(r)).toBe(1);
      await r.unmount();
    });

    it('scored after it landed: the motes and the lit card wait for the score, and the landing that passed does not shake', async () => {
      const { r, motes, trauma, motesUnscored } = await scoredAfter(1500);
      expect(motesUnscored).toBe(0);
      expect(trauma.mock.calls.map(([tier]) => tier)).not.toContain('roundWon');
      expect(motes.mock.calls.map(([o]) => o)).toEqual(['won']);
      expect(lit(r)).toBe(1);
      await r.unmount();
    });
  });

  it.each(CASES)('$outcome under reduced motion: no motes and no shake, and the sting still plays', async (c) => {
    await setMotion('on');
    const { r, motes, trauma, sent } = await closeRound(c);
    expect(motes.mock.results.every(({ value }) => (value as unknown[]).length === 0)).toBe(true);
    expect(trauma.mock.results.every(({ value }) => value === 0)).toBe(true);
    expect(sent.mock.calls.some(([ms]) => ms.some((m) => m.kind === 'roundOver'))).toBe(true);
    await r.unmount();
  });
});
