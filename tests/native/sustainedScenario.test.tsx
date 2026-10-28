import { beforeAll, expect, it, jest } from '@jest/globals';
import type { DiagRow } from '@/lib/diagnostics';
import type { BenchContext } from '@/lib/diagnostics/bench';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row) } }));

let scenarios: Map<string, (ctx: BenchContext) => Promise<void>>;

beforeAll(() => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  require('@/lib/diagnostics/scenarios');
  scenarios = new Map((require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench')).benchScenarios());
});

it('sustained marks one window per 30 s of the minutes asked, frames each, over a table the bots play on, and leaves no table', async () => {
  const log: string[] = [];
  await scenarios.get('sustained')!({
    params: { minutes: '1.5' },
    showTable: async (state) => void log.push(state ? 'table' : 'no table'),
    sleep: async () => {},
    frames: (on) => void log.push(`frames ${on}`),
    armFrames: async (on) => void log.push(`arm ${on}`),
    feltSample: async () => {
      throw new Error('unused');
    },
    gallery: {},
    showNotice: () => {},
  });
  expect(mockRows.flatMap((r) => (r.k === 'window' ? [r.i] : []))).toEqual([0, 1, 2]);
  expect(log.filter((l) => l === 'frames true')).toHaveLength(3);
  expect(log).toContain('table');
  expect(log.at(-2)).toBe('no table');
  expect(log.at(-1)).toBe('arm false');
});
