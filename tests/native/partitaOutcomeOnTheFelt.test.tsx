// tests/native/partitaOutcomeOnTheFelt.test.tsx — a partita's outcome on the felt, through GameTable's own wiring (#1423).
// The draw, the online order and reduced motion are in partitaOutcomeEdges.test.tsx.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MancheMoment } from '@/lib/tokens';
import { bootFeedback } from './helpers/feedback';
import { CASES, METRICS, closePartita } from './helpers/closePartita';

jest.mock('@/lib/accessibility', () => ({
  usePrefersReducedMotion: () => false,
  setMotionPreference: () => {},
  getMotionPreference: () => 'system',
}));

describe("a partita's outcome on the felt", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await bootFeedback();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // One close per case, every assertion on it: each close costs a full table render.
  it.each(CASES)('$name', async (c) => {
    const { r, landed, stings, stingOutcomes, taps, motes, rain, motesBeforeLanding, trauma, target, level, aimBefore } =
      await closePartita(c);

    // the sting is placed 300 ms after the last card lands
    expect(stings).toEqual([landed + 300]);
    expect(stingOutcomes).toEqual([c.outcome]);
    // one medium tap on the contact, then the outcome's, and no landing pulse of its own
    expect(taps).toEqual(['impactMedium', c.outcome === 'won' ? 'notificationSuccess' : 'notificationWarning']);

    // motes at the winner once the last card lands, and rain through the cone only for a win
    expect(motesBeforeLanding).toBe(0);
    expect(motes.mock.calls.map(([o]) => o)).toEqual([c.outcome]);
    expect((motes.mock.results[0].value as unknown[]).length).toBe(c.outcome === 'won' ? MancheMoment.motes.won : MancheMoment.motes.lost);
    const at = motes.mock.calls[0][1];
    // The viewer's seat is at the bottom, the losing cases' winner opposite at the top.
    if (c.outcome === 'won') expect(at.y).toBeGreaterThan(METRICS.frame.height / 2);
    else expect(at.y).toBeLessThan(METRICS.frame.height / 2);
    expect(rain).toHaveBeenCalledTimes(c.outcome === 'won' ? 1 : 0);

    // the table shakes only for a win
    const tiers = trauma.mock.calls.map(([tier]) => tier);
    expect(tiers.includes('partitaWon')).toBe(c.outcome === 'won');
    expect(tiers.includes('mancheWon')).toBe(false);

    // the lamp turns to the winner and dims only for a loss
    expect(aimBefore).toBeDefined();
    const moved = target.mock.calls.some(([, pool]) => pool[0] !== aimBefore![0] || pool[1] !== aimBefore![1]);
    expect(moved).toBe(c.outcome === 'lost');
    const dims = level.mock.calls.filter(([, to, rate]) => to === MancheMoment.lostLevel && rate === MancheMoment.lostLevelRate);
    expect(dims.length > 0).toBe(c.outcome === 'lost');
    await r.unmount();
  });
});
