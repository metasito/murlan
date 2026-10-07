// tests/native/particleLayerTrace.test.tsx — the native particle layer reports its live and
// dropped counts to the trace, as the web layer does (#1258).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockSources = new Map<string, () => unknown>();
jest.mock('@/lib/e2eTrace', () => ({
  useTraceSource: (field: string, read: () => unknown) => mockSources.set(field, read),
}));

import { makeMutable } from 'react-native-reanimated';
import { ParticleLayer } from '@/components/table/particleLayer';
import { restingLamp, TABLE_CENTRE } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';

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
});
