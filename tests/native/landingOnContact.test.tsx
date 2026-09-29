// tests/native/landingOnContact.test.tsx — the landing's dust and haptic start on the frame the
// flight clock brings every card within 1 pt of its slot, read off the drawn transforms.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act } from '@testing-library/react-native';

const mockTraceOnset = jest.fn();
const mockMotion = { reduced: false };

jest.mock('@/components/table/particles', () => {
  const actual = jest.requireActual<typeof import('@/components/table/particles')>('@/components/table/particles');
  return { ...actual, landDust: jest.fn(actual.landDust) };
});
jest.mock('@/lib/e2eTrace', () => ({
  traceOnset: (...args: unknown[]) => mockTraceOnset(...args),
  useTraceSource: () => {},
}));
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockMotion.reduced,
  setMotionPreference: () => {},
  getMotionPreference: () => (mockMotion.reduced ? 'on' : 'off'),
}));

import { landDust } from '@/components/table/particles';
import { bootFeedback, haptics } from './helpers/feedback';
import { frameOfFirst, throwPair } from './helpers/landing';

const landings = () => mockTraceOnset.mock.calls.filter(([kind, name]) => kind === 'moment' && name === 'landing');

describe('the landing on the contact frame', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.useRealTimers();
    mockMotion.reduced = false;
  });

  it('throws the dust on the first frame every card is within 1 pt of its slot, not before', async () => {
    const view = await throwPair();
    const { frame, drawn } = await frameOfFirst(view, () => jest.mocked(landDust).mock.calls.length > 0);
    expect(drawn[frame]).toBeLessThanOrEqual(1);
    expect(drawn[frame - 1]).toBeGreaterThan(1);
    await view.unmount();
  });

  it("starts the viewer's own landing haptic on the contact frame, not before", async () => {
    const view = await throwPair(0);
    const { frame, drawn } = await frameOfFirst(view, () => haptics().length > 0);
    expect(drawn[frame]).toBeLessThanOrEqual(1);
    expect(drawn[frame - 1]).toBeGreaterThan(1);
    expect(haptics()).toEqual(['impactMedium']);
    await view.unmount();
  });

  it('under reduced motion the dust is withheld and the landing is traced on the first frame', async () => {
    mockMotion.reduced = true;
    const view = await throwPair();
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(landings()).toHaveLength(1);
    expect(landDust).not.toHaveBeenCalled();
    await view.unmount();
  });
});
