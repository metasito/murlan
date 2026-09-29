import { beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';

jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (_row: DiagRow) => {} } }));

type Scenario = (ctx: BenchContext) => Promise<void>;
let scenarios: Map<string, Scenario>;
let diagnostics: typeof import('@/lib/diagnostics');

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  require('@/lib/diagnostics/scenarios/idle');
  require('@/lib/diagnostics/scenarios/tapBurst');
  diagnostics = require('@/lib/diagnostics');
  scenarios = new Map((require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench')).benchScenarios());
});

let log: string[];
const table: BenchContext = {
  params: {},
  showTable: async (state) => void log.push(state ? 'table' : 'no table'),
  sleep: async () => {},
  frames: (on) => void log.push(`frames ${on}`),
  armFrames: (on) => void log.push(`arm ${on}`),
  feltSample: async () => {
    throw new Error('unused');
  },
};

beforeEach(() => {
  log = [];
  diagnostics.benchHandles.cardPress = () => {};
});

it.each(['idle', 'tapBurst'])('%s arms the frame loop before its first window and disarms it after the last', async (name) => {
  await scenarios.get(name)!(table);
  expect(log.filter((l) => l.startsWith('arm'))).toEqual(['arm true', 'arm false']);
  expect(log.indexOf('arm true')).toBeLessThan(log.indexOf('frames true'));
  expect(log.at(-1)).toBe('arm false');
});
