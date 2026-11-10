// tests/native/particleLayerTrace.test.tsx — the native particle layer reports its live and
// dropped counts to the trace, as the web layer does (#1258), and mounts its canvas only for bursts.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockSources = new Map<string, () => unknown>();
const mockLive = new Map<object, () => number>();
jest.mock('@/lib/e2eTrace', () => ({
  useTraceSource: (field: string, read: () => unknown) => {
    const React = require('react') as typeof import('react');
    React.useEffect(() => {
      if (field === 'live') {
        mockLive.set(read, read as () => number);
        return () => void mockLive.delete(read);
      }
      mockSources.set(field, read);
    }, [field, read]);
  },
  traceOnset: (...onset: string[]) => mockOnsets.push(onset.join(':')),
}));
const mockOnsets: string[] = [];
jest.mock('@/lib/e2eConfig', () => ({ ...jest.requireActual<object>('@/lib/e2eConfig'), E2E_FAST: true }));

jest.mock('@shopify/react-native-skia', () => {
  const React = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const canvas = ({ testID, children }: { testID?: string; children?: React.ReactNode }) => React.createElement('View', { testID }, children);
  return new Proxy({ Skia: call, PaintStyle: {}, Canvas: canvas } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

let mockAirs = 0;
jest.mock('@/components/table/air', () => {
  const actual = jest.requireActual<typeof import('@/components/table/air')>('@/components/table/air');
  return { ...actual, createAir: (...args: Parameters<typeof actual.createAir>) => (mockAirs++, actual.createAir(...args)) };
});

const live = () => [...mockLive.values()].reduce((n, read) => n + read(), 0);

import { makeMutable } from 'react-native-reanimated';
import { ParticleLayer } from '@/components/table/particleLayer';
import { glossLightOf } from '@/components/table/cardGloss';
import { restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { setMotion } from './harness/env';

const rigOf = (freeze = 0) => {
  const lamp = restingLamp(TABLE_CENTRE);
  return { lamp: makeMutable({ ...lamp, freeze }), stillLight: makeMutable(glossLightOf(lamp)), sx: 1, sy: 1 };
};

const atRest = async (ms: number, freeze = 0) => {
  const view = await render(<ParticleLayer rig={rigOf(freeze)} landing={makeMutable(NO_LANDING)} />);
  const lit = new Set<unknown>();
  let moths = 0;
  for (let t = 0; t < ms; t += 16) {
    await act(async () => jest.advanceTimersByTime(16));
    lit.add(mockSources.get('motes')?.());
    if (mockSources.get('moth')?.()) moths++;
  }
  await view.unmount();
  return { lit, moths };
};

const DUST: ParticleSpawn = {
  x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 1, size: 1, col: '#ffffff', shape: 'dot', glow: 0,
};

describe('ParticleLayer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('traces its live and dropped counts, the 40 motes inside the budget of 200', async () => {
    const ref = React.createRef<ParticleEmitter>();
    const view = await render(<ParticleLayer ref={ref} rig={rigOf()} landing={makeMutable(NO_LANDING)} />);
    expect(live()).toBe(40);
    expect(mockSources.get('moth')?.()).toBeNull();

    await act(async () => ref.current!.emit(Array.from({ length: 203 }, () => DUST)));

    expect(live()).toBe(200);
    expect(mockSources.get('dropped')?.()).toBe(43);
    await view.unmount();
  });

  it('mounts its canvas for a burst only, and takes it down once the burst is spent', async () => {
    const ref = React.createRef<ParticleEmitter>();
    const view = await render(<ParticleLayer ref={ref} rig={rigOf()} landing={makeMutable(NO_LANDING)} />);
    await act(async () => jest.advanceTimersByTime(2000));
    expect(view.queryByTestId('particle-skia')).toBeNull();

    await act(async () => ref.current!.emit([{ ...DUST, life: 0.2 }]));
    expect(view.queryByTestId('particle-skia')).not.toBeNull();

    for (let t = 0; t < 1000; t += 16) await act(async () => jest.advanceTimersByTime(16));
    expect(view.queryByTestId('particle-skia')).toBeNull();
    await view.unmount();
  });

  it('lays the air down once, not on every render', async () => {
    const rig = rigOf();
    const landing = makeMutable(NO_LANDING);
    const before = mockAirs;
    const view = await render(<ParticleLayer rig={rig} landing={landing} />);
    for (let i = 0; i < 3; i++) await view.rerender(<ParticleLayer rig={{ ...rig }} landing={landing} />);
    await view.unmount();
    expect(mockAirs - before).toBe(1);
  });

  it('lights the motes, twinkling, and sends a moth across within 10 s, its onset traced', async () => {
    mockOnsets.length = 0;
    const { lit, moths } = await atRest(10_500);

    expect(Math.max(...(lit as Set<number>))).toBeGreaterThan(0);
    expect(lit.size).toBeGreaterThan(1);
    expect(moths).toBeGreaterThan(0);
    expect(mockOnsets).toEqual(['moment:moth']);
  });

  it('under a frozen lamp sends no moth', async () => {
    mockOnsets.length = 0;
    const { moths } = await atRest(10_500, 1);

    expect(moths).toBe(0);
    expect(mockOnsets).toEqual([]);
  });

  for (const reduced of [false, true]) {
    it(`rains ${reduced ? 'nothing under reduced motion' : "a won match's 60 motes through the cone over 1.2 s"}`, async () => {
      await setMotion(reduced ? 'on' : 'off');
      const ref = React.createRef<ParticleEmitter>();
      const view = await render(<ParticleLayer ref={ref} rig={rigOf()} landing={makeMutable(NO_LANDING)} />);
      await act(async () => jest.advanceTimersByTime(100));
      await act(async () => ref.current!.rain());
      const counts: number[] = [];
      for (let t = 0; t < 1300; t += 16) {
        await act(async () => jest.advanceTimersByTime(16));
        counts.push(live() - 40);
      }
      await view.unmount();

      expect(Math.max(...counts)).toBe(reduced ? 0 : 60);
      if (!reduced) expect(counts[30]).toBeGreaterThan(15);
      if (!reduced) expect(counts[30]).toBeLessThan(45);
    });
  }

  it('under reduced motion holds the motes still and lit, and sends no moth', async () => {
    await setMotion('on');
    mockOnsets.length = 0;
    const { lit, moths } = await atRest(10_500);

    expect(lit.size).toBe(1);
    expect([...lit][0]).toBeGreaterThan(0);
    expect(moths).toBe(0);
    expect(mockOnsets).toEqual([]);
  });
});
