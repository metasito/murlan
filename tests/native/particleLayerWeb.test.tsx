// tests/native/particleLayerWeb.test.tsx — the web particle layer keeps its canvas mounted and its frame callback released
// while nothing flies, wakes on a throw, and releases itself once the burst is spent (rule 51).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { FrameInfo } from 'react-native-reanimated';

// The rest air is a lazy chunk the test runner cannot import dynamically; its layer is tested in particleLayerTrace.
jest.mock('react', () => ({ ...jest.requireActual<typeof import('react')>('react'), lazy: () => () => null }));

const mockControllers: { isActive: boolean }[] = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    useFrameCallback: (cb: (frame: FrameInfo) => void, auto?: boolean) => {
      const controller = actual.useFrameCallback(cb, auto);
      if (!mockControllers.includes(controller)) mockControllers.push(controller);
      return controller;
    },
  };
});

import { makeMutable } from 'react-native-reanimated';
import { ParticleLayer } from '@/components/table/particleLayer.web';
import { glossLightOf } from '@/components/table/cardGloss';
import { restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import type { ParticleEmitter } from '@/components/table/particles';

const lamp = restingLamp(TABLE_CENTRE);
const rig = () => ({ lamp: makeMutable(lamp), stillLight: makeMutable(glossLightOf(lamp)), sx: 1, sy: 1 });
const running = () => mockControllers.filter((c) => c.isActive).length;

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
const count = (n: Node | Node[] | string | null): number => {
  if (!n || typeof n === 'string') return 0;
  if (Array.isArray(n)) return n.reduce((sum: number, c) => sum + count(c), 0);
  return (n.props?.['data-testid'] === 'particles' ? 1 : 0) + (n.children ?? []).reduce((sum: number, c) => sum + count(c as Node), 0);
};
const canvases = (view: Awaited<ReturnType<typeof render>>) => count(view.toJSON() as Node | Node[] | null);

describe('the web particle layer', () => {
  beforeEach(() => {
    mockControllers.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps its canvas, runs no frame callback at rest, one while dust flies, and none once it is spent', async () => {
    const ref = React.createRef<ParticleEmitter>();
    const view = await render(<ParticleLayer ref={ref} rig={rig()} landing={makeMutable(NO_LANDING)} />);
    await act(async () => jest.advanceTimersByTime(3000));
    expect(canvases(view)).toBe(1);
    expect(running()).toBe(0);

    await act(async () => ref.current!.emit([{ x: 0, y: 0, life: 0.2, size: 1 }]));
    await act(async () => jest.advanceTimersByTime(48));
    expect(running()).toBe(1);

    for (let t = 0; t < 1000; t += 16) await act(async () => jest.advanceTimersByTime(16));
    expect(running()).toBe(0);
    expect(canvases(view)).toBe(1);
    await view.unmount();
  });
});
