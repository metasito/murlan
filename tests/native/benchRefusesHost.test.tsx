import { expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
const mockPosted: string[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row), postTo: (host: string) => mockPosted.push(host) } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: 'ran', host: 'evil.example/x?', capture: '1' }),
}));
jest.mock('@/components/GameTable', () => ({ GameTable: () => null }));

it('a deep link with a bad host shows a notice and runs nothing', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  const bench = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  const { probe } = require('@/lib/diagnostics/probe') as typeof import('@/lib/diagnostics/probe');
  const ran = jest.fn(async () => {});
  bench.registerBenchScenario('ran', ran);
  const capture = jest.spyOn(probe, 'startCapture');
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const screen = await render(<BenchScreen />);
  await act(async () => {});
  expect(ran).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  expect(mockPosted).toEqual([]);
  expect(mockRows).toContainEqual(expect.objectContaining({ k: 'refused', host: 'evil.example/x?' }));
  expect(screen.getByRole('alert')).toBeTruthy();
  await screen.unmount();
});
