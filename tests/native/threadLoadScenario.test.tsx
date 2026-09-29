import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';
import type { GameState } from '@/lib/game/gameEngine';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

type Scenario = (ctx: BenchContext) => Promise<void>;
let scenarios: Map<string, Scenario>;
let diagnostics: typeof import('@/lib/diagnostics');

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  require('@/lib/diagnostics/scenarios/threadLoad');
  diagnostics = require('@/lib/diagnostics');
  scenarios = new Map((require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench')).benchScenarios());
});

let log: string[];
let shown: GameState[];
let untils: number[];

const table: BenchContext = {
  params: {},
  showTable: async (state) => {
    if (state) shown.push(state);
    log.push(state ? 'table' : 'no table');
  },
  sleep: async (ms) => void log.push(`sleep ${ms}`),
  frames: (on, until) => {
    log.push(`frames ${on}`);
    if (until !== undefined) untils.push(until);
  },
  armFrames: async (on) => void log.push(`arm ${on}`),
  feltSample: async () => {
    throw new Error('unused');
  },
};

const cardsInHand = (s: GameState) => s.players.reduce((n, p) => n + p.hand.length, 0);
const halves = () => mockRows.flatMap((r) => (r.k === 'half' ? [`${r.name} ${r.pair}`] : []));

describe('the thread-load scenarios drive and record', () => {
  beforeEach(() => {
    mockRows.length = 0;
    log = [];
    shown = [];
    untils = [];
    delete diagnostics.benchHandles.lampFreeze;
    delete diagnostics.benchHandles.feltOpaque;
  });

  it('throwStalls records one throw per card play of one bot manche, never a pass, each with 700 ms of frames', async () => {
    await scenarios.get('throwStalls')!(table);
    const plays = shown.slice(1).filter((s, i) => cardsInHand(s) < cardsInHand(shown[i])).length;
    const passes = shown.slice(1).filter((s, i) => cardsInHand(s) === cardsInHand(shown[i])).length;
    const throws = mockRows.filter((r) => r.k === 'throw').length;
    expect(passes).toBeGreaterThan(0);
    expect(throws).toBe(plays);
    const toggles = log.filter((l) => l.startsWith('frames'));
    expect(toggles).toEqual([...Array.from({ length: throws }, () => ['frames true', 'frames false']).flat(), 'frames false']);
    expect(log.filter((l) => l === 'sleep 700')).toHaveLength(throws);
    expect(untils).toEqual(mockRows.flatMap((r) => (r.k === 'throw' ? [r.t + 600] : [])));
    expect(log.at(-1)).toBe('arm false');
  });

  it('each scenario arms the frame loop before its first window and disarms it after the last', async () => {
    diagnostics.benchHandles.lampFreeze = () => {};
    diagnostics.benchHandles.feltOpaque = () => {};
    for (const name of ['throwStalls', 'restCost', 'feltOpaque']) {
      log = [];
      await scenarios.get(name)!(table);
      const arms = log.filter((l) => l.startsWith('arm'));
      expect(arms).toEqual(['arm true', 'arm false']);
      expect(log[0]).toBe('arm true');
      expect(log.at(-1)).toBe('arm false');
    }
  });

  it('a failing scenario still disarms the frame loop', async () => {
    await expect(scenarios.get('restCost')!(table)).rejects.toThrow();
    expect(log.at(-1)).toBe('arm false');
  });

  it('restCost records four pairs of 30 s halves in ABBA order, and leaves the lamp swaying', async () => {
    const freezes: number[] = [];
    diagnostics.benchHandles.lampFreeze = (amount) => void freezes.push(amount);
    await scenarios.get('restCost')!(table);
    expect(halves()).toEqual(['frozen 0', 'swaying 0', 'swaying 1', 'frozen 1', 'frozen 2', 'swaying 2', 'swaying 3', 'frozen 3']);
    expect(freezes).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(log.filter((l) => l === 'sleep 30000')).toHaveLength(8);
    expect(log.filter((l) => l === 'frames true')).toHaveLength(8);
  });

  it('feltOpaque records four pairs of 20 s halves in ABBA order, and leaves the felt opaque', async () => {
    const flips: boolean[] = [];
    diagnostics.benchHandles.feltOpaque = (on) => void flips.push(on);
    await scenarios.get('feltOpaque')!(table);
    expect(halves()).toEqual(['on 0', 'off 0', 'off 1', 'on 1', 'on 2', 'off 2', 'off 3', 'on 3']);
    expect(flips).toEqual([true, false, false, true, true, false, false, true, true]);
    expect(log.filter((l) => l === 'sleep 20000')).toHaveLength(8);
  });

  it('a table that registered no handle fails the scenario instead of recording halves', async () => {
    await expect(scenarios.get('restCost')!(table)).rejects.toThrow('no table registered lampFreeze');
    await expect(scenarios.get('feltOpaque')!(table)).rejects.toThrow('no table registered feltOpaque');
    expect(mockRows.filter((r) => r.k === 'half')).toHaveLength(0);
  });

  it('a throwStalls that fails mid-window leaves no pending close to shut the next scenario\'s window', async () => {
    const pending: (() => void)[] = [];
    let steps = 0;
    const failing: BenchContext = {
      ...table,
      sleep: (ms) => (ms === 700 ? new Promise<void>((r) => pending.push(r)) : Promise.resolve()),
      showTable: async (state) => {
        if (state && ++steps === 3) throw new Error('boom');
        log.push(state ? 'table' : 'no table');
      },
    };
    await expect(scenarios.get('throwStalls')!(failing)).rejects.toThrow('boom');
    expect(pending.length).toBeGreaterThan(0);
    log = [];
    pending.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual([]);
  });

  it('throwStalls closes the recording and clears the table when the drive fails', async () => {
    let steps = 0;
    const failing: BenchContext = {
      ...table,
      showTable: async (state) => {
        if (state && ++steps === 3) throw new Error('boom');
        log.push(state ? 'table' : 'no table');
      },
    };
    await expect(scenarios.get('throwStalls')!(failing)).rejects.toThrow('boom');
    expect(log.filter((l) => l.startsWith('frames')).at(-1)).toBe('frames false');
    expect(log.slice(-2)).toEqual(['no table', 'arm false']);
  });
});
