import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';

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

const table: BenchContext = {
  params: {},
  showTable: async (state) => void log.push(state ? 'table' : 'no table'),
  sleep: async (ms) => void log.push(`sleep ${ms}`),
  frames: (on) => {
    const last = mockRows.at(-1);
    log.push(`frames ${on}${on && last ? ` after ${last.k}` : ''}`);
  },
  feltSample: async () => {
    throw new Error('unused');
  },
};

describe('the thread-load scenarios drive and record', () => {
  beforeEach(() => {
    mockRows.length = 0;
    log = [];
    delete diagnostics.benchHandles.lampFreeze;
    delete diagnostics.benchHandles.feltOpaque;
  });

  it('throwStalls opens 700 ms of frames on each bot throw of one manche, and closes each before the next', async () => {
    await scenarios.get('throwStalls')!(table);
    const throws = mockRows.filter((r) => r.k === 'throw').length;
    const toggles = log.filter((l) => l.startsWith('frames'));
    expect(throws).toBeGreaterThanOrEqual(10);
    expect(toggles).toEqual(Array.from({ length: throws }, () => ['frames true after throw', 'frames false']).flat());
    expect(log.filter((l) => l === 'sleep 700')).toHaveLength(throws);
    expect(log.at(-1)).toBe('no table');
  });

  it('restCost records four pairs of 30 s halves, frozen then swaying, and leaves the lamp swaying', async () => {
    const freezes: number[] = [];
    diagnostics.benchHandles.lampFreeze = (amount) => void freezes.push(amount);
    await scenarios.get('restCost')!(table);
    const halves = mockRows.flatMap((r) => (r.k === 'half' ? [`${r.name} ${r.pair}`] : []));
    expect(halves).toEqual(['frozen 0', 'swaying 0', 'frozen 1', 'swaying 1', 'frozen 2', 'swaying 2', 'frozen 3', 'swaying 3']);
    expect(freezes).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(log.filter((l) => l === 'sleep 30000')).toHaveLength(8);
    expect(log.filter((l) => l === 'frames true after half')).toHaveLength(8);
  });

  it('feltOpaque records four pairs of 20 s halves, on then off, and leaves the felt opaque', async () => {
    const flips: boolean[] = [];
    diagnostics.benchHandles.feltOpaque = (on) => void flips.push(on);
    await scenarios.get('feltOpaque')!(table);
    const halves = mockRows.flatMap((r) => (r.k === 'half' ? [`${r.name} ${r.pair}`] : []));
    expect(halves).toEqual(['on 0', 'off 0', 'on 1', 'off 1', 'on 2', 'off 2', 'on 3', 'off 3']);
    expect(flips).toEqual([true, false, true, false, true, false, true, false, true]);
    expect(log.filter((l) => l === 'sleep 20000')).toHaveLength(8);
  });

  it('a table that registered no handle fails the scenario instead of recording halves', async () => {
    await expect(scenarios.get('restCost')!(table)).rejects.toThrow('no table registered lampFreeze');
    await expect(scenarios.get('feltOpaque')!(table)).rejects.toThrow('no table registered feltOpaque');
    expect(mockRows.filter((r) => r.k === 'half')).toHaveLength(0);
  });
});
