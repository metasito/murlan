// tests/native/duringEpoch.test.tsx — a release a frame scheduled before a wake never puts the wake to sleep (lib/motion.ts useDuring).
import { describe, it, expect, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { FrameInfo } from 'react-native-reanimated';

const mockFrames: { tick: (frame: FrameInfo) => void; controller: { isActive: boolean; setActive(on: boolean): void } }[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (tick: (frame: FrameInfo) => void, auto?: boolean) => {
      const controller = { isActive: !!auto, setActive: (on: boolean) => void (controller.isActive = on) };
      if (!mockFrames.some((f) => f.tick === tick)) mockFrames.push({ tick, controller });
      return mockFrames.find((f) => f.tick === tick)!.controller;
    },
  };
});

const mockPending: (() => void)[] = [];
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual<object>('react-native-worklets'),
  isRNRuntime: () => true,
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void mockPending.push(() => fn(...args)),
}));

import { useDuring } from '@/lib/motion';

const FRAME: FrameInfo = { timestamp: 0, timeSincePreviousFrame: 16, timeSinceFirstFrame: 0 };

describe('useDuring', () => {
  it('keeps a wake that landed while a frame was deciding to sleep, whichever write reaches `dirty` last', async () => {
    mockFrames.length = 0;
    mockPending.length = 0;
    let wake: () => void = () => {};
    // The wake arrives between the frame's start and its verdict, as the UI thread's own write to `dirty` lands after it.
    const hook = await renderHook(() => (wake = useDuring(() => (wake(), false), true)));
    const { tick, controller } = mockFrames[0];
    await hook.rerender({});
    tick(FRAME);
    expect(mockPending).toHaveLength(1);
    for (const run of mockPending.splice(0)) run();
    expect(controller.isActive).toBe(true);
  });

  it('still puts an idle callback to sleep', async () => {
    mockFrames.length = 0;
    mockPending.length = 0;
    await renderHook(() => useDuring(() => false, true));
    const { tick, controller } = mockFrames[0];
    tick(FRAME);
    for (const run of mockPending.splice(0)) run();
    expect(controller.isActive).toBe(false);
  });
});
