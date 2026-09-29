import { expect, it, jest } from '@jest/globals';
import { Profiler } from 'react';
import { act, render } from '@testing-library/react-native';
import type { DiagRow } from '@/lib/diagnostics';

const mockRows: DiagRow[] = [];
jest.mock('@/lib/diagnostics/recorder', () => ({ recorder: { push: (row: DiagRow) => mockRows.push(row), postTo: () => {} } }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-router', () => ({
  router: { replace: () => {} },
  useLocalSearchParams: () => ({ scenario: 'recordingToggle,unarmedFrames', capture: '0' }),
}));

let mockTableRenders = 0;
jest.mock('@/components/GameTable', () => ({
  GameTable: () => {
    mockTableRenders++;
    return null;
  },
}));

const setActEnvironment = (on: boolean) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
};

it('a recording window commits no render, and a scenario that never armed the frame loop fails on its first window', async () => {
  process.env.EXPO_PUBLIC_DIAGNOSTICS = '1';
  const bench = require('@/lib/diagnostics/bench') as typeof import('@/lib/diagnostics/bench');
  const { benchTable } = require('@/lib/diagnostics/benchTable') as typeof import('@/lib/diagnostics/benchTable');
  let commits = 0;
  const counts: [number, number][] = [];
  bench.registerFramedScenario('recordingToggle', async (ctx) => {
    await ctx.showTable(benchTable());
    await ctx.sleep(20);
    counts.push([commits, mockTableRenders]);
    ctx.frames(true);
    await ctx.sleep(20);
    ctx.frames(false);
    await ctx.sleep(20);
    counts.push([commits, mockTableRenders]);
    await ctx.showTable(null);
  });
  bench.registerBenchScenario('unarmedFrames', async (ctx) => {
    ctx.frames(true);
    ctx.frames(false);
  });
  const ended = (name: string) => mockRows.find((r) => r.k === 'scenario' && r.name === name && r.phase === 'end');
  const { BenchScreen } = require('@/components/BenchScreen') as typeof import('@/components/BenchScreen');
  const view = await render(
    <Profiler id="bench" onRender={() => void commits++}>
      <BenchScreen />
    </Profiler>
  );
  setActEnvironment(false);
  for (let i = 0; i < 200 && !ended('unarmedFrames'); i++) await new Promise((r) => setTimeout(r, 10));
  setActEnvironment(true);
  await act(async () => {});
  expect(counts[0][1]).toBeGreaterThan(0);
  expect(counts[1]).toEqual(counts[0]);
  expect(ended('recordingToggle')).toMatchObject({ error: null });
  expect(ended('unarmedFrames')).toMatchObject({ error: expect.stringContaining('registerFramedScenario') });
  await view.unmount();
});
