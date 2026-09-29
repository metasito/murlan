import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockTraceOnset = jest.fn();

jest.mock('@/lib/e2eTrace', () => ({
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
}));

import { event, resetFeedback, setHapticsEnabled, setSoundVolume, uiFeedback } from '@/lib/device/feedback';

const PLAY = { kind: 'landing', cards: 1, bomb: false, mine: false } as const;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('the E2E trace records an onset only for an effect that fires', () => {
  beforeEach(() => {
    mockTraceOnset.mockClear();
    resetFeedback();
  });

  it('records a haptic and a sound that fire', async () => {
    uiFeedback('light');
    event([PLAY]);
    await flush();
    expect(mockTraceOnset.mock.calls).toEqual([
      ['haptic', 'light'],
      ['sound', 'play'],
    ]);
  });

  it('records nothing with haptics off', () => {
    setHapticsEnabled(false);
    uiFeedback('light');
    expect(mockTraceOnset).not.toHaveBeenCalled();
  });

  it('records nothing at zero volume', async () => {
    setSoundVolume(0);
    event([PLAY]);
    await flush();
    expect(mockTraceOnset).not.toHaveBeenCalled();
  });
});
