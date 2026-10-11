// tests/native/partitaOutcomeEdges.test.tsx — a drawn partita, a partita decided mid-flight, and reduced motion, on the felt (#1423).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { MancheMoment } from '@/lib/tokens';
import { bootFeedback, haptics, settle } from './helpers/feedback';
import { CASES, DRAWS, closePartita, table } from './helpers/closePartita';

let mockReduceMotion = false;
jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => mockReduceMotion,
  setMotionPreference: () => {},
  getMotionPreference: () => 'system',
}));

describe("a partita's outcome on the felt, at its edges", () => {
  beforeEach(async () => {
    mockReduceMotion = false;
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(DRAWS)('$name: a co-winner gets neither the win nor the loss, on the felt or in the sting', async (c) => {
    const { r, motes, rain, trauma, level, stingOutcomes, taps } = await closePartita(c);
    expect(motes.mock.calls.map(([o]) => o)).toEqual(['draw']);
    expect(rain).not.toHaveBeenCalled();
    expect(trauma.mock.calls.map(([tier]) => tier)).not.toContain('partitaWon');
    expect(level.mock.calls.some(([, to]) => to === MancheMoment.lostLevel)).toBe(false);
    expect(stingOutcomes).toEqual(['draw']);
    expect(taps).toEqual(['impactMedium']);
    await r.unmount();
  });

  // Online, the scores and `matchOver` come after the state that ends the manche.
  it('the partita decided while the viewer\'s last card flies: its landing still pulses nothing of its own', async () => {
    const c = CASES[1];
    const r = await render(table(c, false));
    await settle(2000);
    await bootFeedback();
    const tapsBefore = haptics().length;
    await act(async () => r.rerender(table(c, true, false)));
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    await act(async () => r.rerender(table(c, true, true)));
    await settle(1500);
    expect(haptics().slice(tapsBefore)).toEqual(['impactMedium', 'notificationSuccess']);
    await r.unmount();
  });

  it.each([CASES[0], CASES[3]])('$name under reduced motion: no motes, no rain and no shake, while the sting still plays 300 ms after the landing', async (c) => {
    mockReduceMotion = true;
    const { r, motes, rain, trauma, landed, stings } = await closePartita(c);
    expect(motes.mock.results.every(({ value }) => (value as unknown[]).length === 0)).toBe(true);
    expect(rain).not.toHaveBeenCalled();
    expect(trauma.mock.results.every(({ value }) => value === 0)).toBe(true);
    expect(stings).toHaveLength(1);
    expect(stings[0] - landed).toBeLessThanOrEqual(300);
    expect(stings[0] - landed).toBeGreaterThan(0);
    await r.unmount();
  });
});
