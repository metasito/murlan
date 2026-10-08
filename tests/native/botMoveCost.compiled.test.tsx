// tests/native/botMoveCost.compiled.test.tsx — what one bot move costs the table, under the React
// Compiler the app ships with: a commit that only moves a flight or the turn renders no child whose
// props it left alone.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { GameState } from '@/lib/game/gameEngine';
import { botManche, STEP_MS } from './helpers/botManche';
import { settle } from './helpers/feedback';

const mockRenders: Record<string, number> = {};
const onCommit: ProfilerOnRenderCallback = (id) => {
  mockRenders[id] = (mockRenders[id] ?? 0) + 1;
};

type Render = (p: object) => React.ReactNode;
type Memo = { type: Render; compare?: (a: object, b: object) => boolean };

// Counts the component's own body, inside its memo if it has one: a counter outside the memo counts the parent instead.
function mockProfiled(path: string, names: string[]) {
  const R = jest.requireActual('react') as typeof React;
  const actual = jest.requireActual(path) as Record<string, Render | Memo>;
  const wrap = (name: string) => {
    const c = actual[name];
    const body = typeof c === 'function' ? c : c.type;
    let last: Record<string, unknown> | null = null;
    const counted = (p: object) => {
      const q = p as Record<string, unknown>;
      last = q;
      mockRenders[name] = (mockRenders[name] ?? 0) + 1;
      return body(p);
    };
    return typeof c === 'function' ? counted : R.memo(counted, c.compare);
  };
  return { ...actual, ...Object.fromEntries(names.map((name) => [name, wrap(name)])) };
}

jest.mock('@/components/table/seats', () => mockProfiled('@/components/table/seats', ['TopOppSlot', 'SideOppSlot']));
jest.mock('@/components/table/pile', () => mockProfiled('@/components/table/pile', ['PileLayer']));
jest.mock('@/components/table/hand', () => mockProfiled('@/components/table/hand', ['StraightHand']));

const { GameTable } = require('@/components/GameTable') as typeof import('@/components/GameTable');

const METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const noop = () => {};
const table = (s: GameState) => (
  <Profiler id="commits" onRender={onCommit}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <GameTable gameState={s} viewerSeat={0} onPlay={noop} onPass={noop} onQuit={noop} onExchangeGive={noop} handScores={{}} />
    </SafeAreaProvider>
  </Profiler>
);

type Cost = { commits: number; TopOppSlot: number; SideOppSlot: number; PileLayer: number; StraightHand: number };
const MOVES = 16;

async function costPerMove(): Promise<Cost[]> {
  const [dealt, ...moves] = botManche();
  const view = await render(table(dealt));
  await settle(3000);
  const costs: Cost[] = [];
  for (const s of moves.slice(0, MOVES)) {
    for (const k of Object.keys(mockRenders)) delete mockRenders[k];
    await act(async () => view.rerender(table(s)));
    await settle(STEP_MS);
    const { commits = 0, TopOppSlot = 0, SideOppSlot = 0, PileLayer = 0, StraightHand = 0 } = mockRenders;
    costs.push({ commits, TopOppSlot, SideOppSlot, PileLayer, StraightHand });  }
  await view.unmount();
  return costs;
}

const most = (costs: Cost[], k: keyof Cost) => Math.max(...costs.map((c) => c[k]));
const total = (costs: Cost[], k: keyof Cost) => costs.reduce((sum, c) => sum + c[k], 0);

describe('one bot move', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(noop);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders the hand and the seats only on the commits that change them', async () => {
    const costs = await costPerMove();
    const commits = total(costs, 'commits');
    expect(costs).toHaveLength(MOVES);
    expect(most(costs, 'commits')).toBeGreaterThanOrEqual(3);
    expect(most(costs, 'PileLayer')).toBeGreaterThanOrEqual(2);
    expect(total(costs, 'StraightHand')).toBeLessThanOrEqual(commits / 2);
    expect(total(costs, 'PileLayer')).toBeLessThan(commits);
    expect(most(costs, 'TopOppSlot')).toBeLessThanOrEqual(2);
    expect(most(costs, 'SideOppSlot')).toBeLessThanOrEqual(4);
  }, 120_000);
});
