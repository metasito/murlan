// tests/native/particleLayerTrace.test.tsx — the native particle layer reports its live and
// dropped counts to the trace, as the web layer does (#1258).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockSources = new Map<string, () => unknown>();
jest.mock('@/lib/e2eTrace', () => ({
  useTraceSource: (field: string, read: () => unknown) => mockSources.set(field, read),
}));

let mockReduced = false;
jest.mock('@/lib/accessibility', () => ({
  ...jest.requireActual<object>('@/lib/accessibility'),
  usePrefersReducedMotion: () => mockReduced,
}));

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
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      mockReduced = false;
    });

    it('lights the motes, twinkling, and sends a moth across within 10 s', async () => {
      const { lit, moths } = await atRest(10_500);

      expect(Math.max(...(lit as Set<number>))).toBeGreaterThan(0);
      expect(lit.size).toBeGreaterThan(1);
      expect(moths).toBeGreaterThan(0);
    });

    it('under reduced motion holds the motes still and lit, and sends no moth', async () => {
      mockReduced = true;
      const { lit, moths } = await atRest(10_500);

      expect(lit.size).toBe(1);
      expect([...lit][0]).toBeGreaterThan(0);
      expect(moths).toBe(0);
    });
  });
});
