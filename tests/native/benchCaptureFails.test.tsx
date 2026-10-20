import { expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row), postTo: () => {} } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: 'quick' }),
}));
jest.mock('@/components/GameTable', () => ({ GameTable: () => null }));

it('a capture that fails to stop is recorded, not swallowed', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  const bench = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  const { probe } = require('@/lib/diagnostics/probe') as typeof import('@/lib/diagnostics/probe');
  bench.registerBenchScenario('quick', async () => {});
  jest.spyOn(probe, 'canCapture').mockReturnValue(true);
  jest.spyOn(probe, 'startCapture').mockResolvedValue(true);
  jest.spyOn(probe, 'stopCapture').mockRejectedValue(new Error('E_CAPTURE: recording interrupted'));
  const ended = () => mockRows.find((r) => r.k === 'run' && r.phase === 'end');
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const screen = await render(<BenchScreen />);
  for (let i = 0; i < 200 && !ended(); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(ended()).toBeTruthy();
  expect(mockRows).toContainEqual(expect.objectContaining({ k: 'capture', phase: 'stop', error: expect.stringContaining('recording interrupted') }));
  await screen.unmount();
});
