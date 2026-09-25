// tests/native/particleLayerTrace.test.tsx — the native particle layer reports its live and
// dropped counts to the trace, as the web layer does (#1258).
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { ParticleEmitter, ParticleSpawn } from '@/components/table/particles';

const mockSources = new Map<string, () => number>();
jest.mock('@/lib/e2eTrace', () => ({
  useTraceSource: (field: string, read: () => number) => mockSources.set(field, read),
}));

import { ParticleLayer } from '@/components/table/particleLayer';

const DUST: ParticleSpawn = {
  x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 1, size: 1, col: '#ffffff', shape: 'dot', glow: 0,
};

describe('ParticleLayer', () => {
  it('traces its live and dropped counts', async () => {
    const ref = React.createRef<ParticleEmitter>();
    const view = await render(<ParticleLayer ref={ref} sx={1} sy={1} />);
    expect(mockSources.get('live')?.()).toBe(0);

    await act(async () => ref.current!.emit(Array.from({ length: 203 }, () => DUST)));

    expect(mockSources.get('live')?.()).toBe(200);
    expect(mockSources.get('dropped')?.()).toBe(3);
    await view.unmount();
  });
});
