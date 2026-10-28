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

it('dealBurst unmounts the table, opens a frame window, mounts a fresh deal inside it, ten times, and leaves no table', async () => {
  const log: string[] = [];
  await scenarios.get('dealBurst')!({
    params: {},
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
  expect(mockRows.flatMap((r) => (r.k === 'window' ? [r.i] : []))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const one = log.slice(1, 6);
  expect(one).toEqual(['no table', 'frames true', 'table', 'frames false', 'no table']);
  expect(log.filter((l) => l === 'table')).toHaveLength(10);
  expect(log.at(-1)).toBe('arm false');
});
