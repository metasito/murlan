import { expect, it, jest } from '@jest/globals';
import { Profiler } from 'react';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (_row: DiagRow) => {}, postTo: () => {} } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: 'recordingToggle', capture: '0' }),
}));

let mockTableRenders = 0;
jest.mock('@/components/GameTable', () => ({
  GameTable: () => {
    mockTableRenders++;
    return null;
  },
}));

it('opening and closing a recording window commits no render, so no GameTable renders with it', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  const { registerBenchScenario } = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  const { benchTable } = require('@/lib/diagnostics/benchTable') as typeof import('@/lib/diagnostics/benchTable');
  let commits = 0;
  const counts: [number, number][] = [];
  const done = new Promise<void>((resolve) =>
    registerBenchScenario('recordingToggle', async (ctx) => {
      await ctx.showTable(benchTable());
      await ctx.sleep(20);
      counts.push([commits, mockTableRenders]);
      ctx.frames(true);
      await ctx.sleep(20);
      ctx.frames(false);
      await ctx.sleep(20);
      counts.push([commits, mockTableRenders]);
      resolve();
    })
  );
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const view = await render(
    <Profiler id="bench" onRender={() => void commits++}>
      <BenchScreen />
    </Profiler>
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  await done;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {});
  expect(counts[0][1]).toBeGreaterThan(0);
  expect(counts[1]).toEqual(counts[0]);
  await view.unmount();
});
