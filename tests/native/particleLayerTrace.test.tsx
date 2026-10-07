// tests/native/particleLayerTrace.test.tsx — the native particle layer reports its live and
// dropped counts to the trace, as the web layer does (#1258).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockSources = new Map<string, () => unknown>();
jest.mock('@/lib/e2eTrace', () => ({
  useTraceSource: (field: string, read: () => unknown) => mockSources.set(field, read),
  traceOnset: (...onset: string[]) => mockOnsets.push(onset.join(':')),
}));
const mockOnsets: string[] = [];

let mockReduced = false;
jest.mock('@/lib/accessibility', () => ({
  ...jest.requireActual<object>('@/lib/accessibility'),
  usePrefersReducedMotion: () => mockReduced,
}));

const mockShapes = { built: 0 };
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react') as typeof import('react');
  const call: object = new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : call), apply: () => call });
  const element = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const rect = () => (mockShapes.built++, call);
  return new Proxy({ Skia: call, PaintStyle: {}, rect } as Record<string | symbol, unknown>, {
    get: (known, key) => (key === '__esModule' ? true : key in known ? known[key] : element),
  });
});

import { makeMutable } from 'react-native-reanimated';
import { ParticleLayer } from '@/components/table/particleLayer';
import { restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';

const atRest = async (ms: number) => {
  const rig = { lamp: makeMutable(restingLamp(TABLE_CENTRE)), sx: 1, sy: 1 };
  const view = await render(<ParticleLayer rig={rig} landing={makeMutable(NO_LANDING)} />);
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
  it('traces its live and dropped counts, the 40 motes inside the budget of 200', async () => {
    const ref = React.createRef<ParticleEmitter>();
    const rig = { lamp: makeMutable(restingLamp(TABLE_CENTRE)), sx: 1, sy: 1 };
    const view = await render(<ParticleLayer ref={ref} rig={rig} landing={makeMutable(NO_LANDING)} />);
    expect(mockSources.get('live')?.()).toBe(40);
    expect(mockSources.get('moth')?.()).toBeNull();

    await act(async () => ref.current!.emit(Array.from({ length: 203 }, () => DUST)));

    expect(mockSources.get('live')?.()).toBe(200);
    expect(mockSources.get('dropped')?.()).toBe(43);
    await view.unmount();
  });


  describe('at rest, frame by frame', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
      mockReduced = false;
    });

    it('lights the motes, twinkling, and sends a moth across within 10 s, its onset traced', async () => {
      mockOnsets.length = 0;
      const { lit, moths } = await atRest(10_500);

      expect(Math.max(...(lit as Set<number>))).toBeGreaterThan(0);
      expect(lit.size).toBeGreaterThan(1);
      expect(moths).toBeGreaterThan(0);
      expect(mockOnsets).toEqual(['moment:moth']);
    });

    it('builds the moth\'s shapes only on frames with a moth on the light', async () => {
      const rig = { lamp: makeMutable(restingLamp(TABLE_CENTRE)), sx: 1, sy: 1 };
      const view = await render(<ParticleLayer rig={rig} landing={makeMutable(NO_LANDING)} />);
      let idle = 0;
      let flying = 0;
      for (let t = 0; t < 10_500; t += 16) {
        const before = mockShapes.built;
        const flew = mockSources.get('moth')?.();
        await act(async () => jest.advanceTimersByTime(16));
        if (mockSources.get('moth')?.()) flying += mockShapes.built - before;
        else if (t > 0 && !flew) idle += mockShapes.built - before;
      }
      await view.unmount();

      expect(flying).toBeGreaterThan(0);
      expect(idle).toBe(0);
    });

    it('under reduced motion holds the motes still and lit, and sends no moth', async () => {
      mockReduced = true;
      mockOnsets.length = 0;
      const { lit, moths } = await atRest(10_500);

      expect(lit.size).toBe(1);
      expect([...lit][0]).toBeGreaterThan(0);
      expect(moths).toBe(0);
      expect(mockOnsets).toEqual([]);
    });
  });
});
