import { expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
let mockScenario = 'boom';
let mockThrowing = false;
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => {
    if (mockThrowing && row.k === 'run') throw new Error('push');
    mockRows.push(row);
  }, postTo: () => {} } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: mockScenario, capture: '0' }),
}));
jest.mock('@/components/GameTable', () => ({ GameTable: () => null }));

it('a run that throws outright does not stop the next run, and unmounting stops the drain', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  const bench = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  const { probe } = require('@/lib/diagnostics/probe') as typeof import('@/lib/diagnostics/probe');
  const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
  bench.registerBenchScenario('after', async () => {});
  bench.registerBenchScenario('hang', () => new Promise<void>(() => {}));
  const drain = jest.spyOn(probe, 'drain');
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const ended = (name: string) => mockRows.some((r) => r.k === 'scenario' && r.name === name && r.phase === 'end');

  mockThrowing = true;
  const first = await render(<BenchScreen />);
  await act(async () => {});
  await first.unmount();
  expect(logged).toHaveBeenCalledWith('bench run failed', expect.anything());
  mockThrowing = false;
  mockScenario = 'after';
  const second = await render(<BenchScreen />);
  for (let i = 0; i < 100 && !ended('after'); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  expect(ended('after')).toBe(true);
  await second.unmount();

  jest.useFakeTimers();
  mockScenario = 'hang';
  const third = await render(<BenchScreen />);
  await act(async () => {});
  jest.advanceTimersByTime(2500);
  const ticks = drain.mock.calls.length;
  expect(ticks).toBeGreaterThan(0);
  await third.unmount();
  jest.advanceTimersByTime(5000);
  expect(drain.mock.calls.length).toBe(ticks);
  jest.useRealTimers();
});
