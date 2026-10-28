import { expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => void mockRows.push(row), postTo: () => {} } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: 'first,second', capture: '0' }),
}));
jest.mock('@/components/GameTable', () => ({ GameTable: () => null }));

const starts = (name: string) => mockRows.filter((r) => r.k === 'scenario' && r.name === name && r.phase === 'start').length;
const settle = async (until: () => boolean) => {
  for (let i = 0; i < 200 && !until(); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};

it('a relaunch skips what finished, retries what did not, and gives up after MAX_STARTS', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  await AsyncStorage.clear();
  const bench = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  bench.registerBenchScenario('first', async () => {});
  bench.registerBenchScenario('second', async () => { throw new Error('boom'); });
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const ran = () => mockRows.some((r) => r.k === 'run' && r.phase === 'end');

  const a = await render(<BenchScreen />);
  await settle(ran);
  await a.unmount();
  expect(starts('first')).toBe(1);
  expect(starts('second')).toBe(1);

  mockRows.length = 0;
  const b = await render(<BenchScreen />);
  await settle(() => mockRows.some((r) => r.k === 'resume'));
  await b.unmount();
  expect(starts('first') + starts('second')).toBe(0);
});

it('a scenario killed mid-run is started again, and one killed MAX_STARTS times is recorded as abandoned', async () => {
  const { benchBuild } = require('@/lib/diagnostics/build') as typeof import('@/lib/diagnostics/build');
  const { MAX_STARTS } = require('@/lib/diagnostics/benchProgress') as typeof import('@/lib/diagnostics/benchProgress');
  const { BENCH_PROGRESS_KEY } = require('@/lib/storageKeys') as typeof import('@/lib/storageKeys');
  await AsyncStorage.setItem(BENCH_PROGRESS_KEY, JSON.stringify({
    key: `${benchBuild().scriptURL}|first,second`, done: [], starts: { first: 1, second: MAX_STARTS }, results: {}, finished: false, at: Date.now(),
  }));
  mockRows.length = 0;
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const c = await render(<BenchScreen />);
  await settle(() => mockRows.some((r) => r.k === 'run' && r.phase === 'end'));
  await c.unmount();
  expect(starts('first')).toBe(1);
  const second = mockRows.filter((r) => r.k === 'scenario' && r.name === 'second' && r.phase === 'end');
  expect(second).toHaveLength(1);
  expect((second[0] as { error?: string }).error).toMatch(/abandoned/);
});
