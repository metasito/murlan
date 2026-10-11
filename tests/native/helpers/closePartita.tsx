// tests/native/helpers/closePartita.tsx — a partita closed through GameTable's own wiring, for the
// files that judge its outcome on the felt (#1423).
import { jest } from '@jest/globals';
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
import { bootFeedback, haptics, settle } from './feedback';
import { card, PAIR } from './landing';

export const METRICS = {
  frame: { x: 0, y: 0, width: 844, height: 390 },
  insets: { top: 0, left: 47, right: 34, bottom: 0 },
};
const noop = () => {};
const LAST: Combination = { type: 'pair', cards: [card('k1', 'K', 'clubs'), card('k2', 'K', 'diamonds')], strength: 13 };
const RANKINGS = ['player_1', 'player_2', 'player_3', 'player_0'];

export interface Case {
  name: string;
  outcome: 'won' | 'lost' | 'draw';
  teams: boolean;
  winners: string[];
  closer: number;
}
// Seat 0 is the viewer, seat 2 sits opposite; in teams seats 0 and 3 are side A.
export const CASES: Case[] = [
  { name: 'won, an opponent closing', outcome: 'won', teams: false, winners: ['player_0'], closer: 3 },
  { name: 'won, the viewer closing', outcome: 'won', teams: false, winners: ['player_0'], closer: 0 },
  { name: 'won by the partner in teams', outcome: 'won', teams: true, winners: ['player_3', 'player_0'], closer: 3 },
  { name: 'lost, the viewer closing', outcome: 'lost', teams: false, winners: ['player_2'], closer: 0 },
  { name: 'lost, an opponent closing', outcome: 'lost', teams: false, winners: ['player_2'], closer: 3 },
];
export const DRAWS: Case[] = [
  { name: 'drawn, the viewer listed first', outcome: 'draw', teams: false, winners: ['player_0', 'player_2'], closer: 3 },
  { name: 'drawn, the viewer listed second', outcome: 'draw', teams: false, winners: ['player_2', 'player_0'], closer: 3 },
];

const seat = (i: number, teams: boolean): Player => ({
  id: `player_${i}`,
  name: `P${i}`,
  hand: [],
  type: 'human',
  ...(teams ? { team: i === 0 || i === 3 ? 'A' : 'B' } : {}),
});

export const table = (c: Case, over: boolean, decided = over) => {
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

export async function closePartita(c: Case) {
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
  const momentsOf = (kind: string) => sent.mock.calls.flatMap(([ms, at]) => ms.filter((m) => m.kind === kind).map((m) => ({ m, at: at! })));
  const stingMoments = momentsOf('partitaOver');
  return {
    r, motes, rain, trauma, target, level, aimBefore, motesBeforeLanding,
    landed: momentsOf('landing')[0]?.at,
    stings: stingMoments.map(({ at }) => at),
    stingOutcomes: stingMoments.map(({ m }) => (m.kind === 'partitaOver' ? m.outcome : undefined)),
    taps: haptics().slice(tapsBefore),
  };
}
