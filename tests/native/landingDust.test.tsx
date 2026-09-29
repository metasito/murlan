// tests/native/landingDust.test.tsx — the card landing (#1258): on the contact frame the table
// throws `landDust` into its one particle layer around the pile's centre.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('@/components/table/particles', () => {
  const actual = jest.requireActual<typeof import('@/components/table/particles')>('@/components/table/particles');
  return { ...actual, landDust: jest.fn(actual.landDust) };
});

import { landDust } from '@/components/table/particles';
import { frameOfFirst, throwPair } from './helpers/landing';

describe('the card landing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws 16 + 5n dust and three puffs around the pile on the contact frame', async () => {
    const view = await throwPair();
    const dust = jest.mocked(landDust);
    const { frame, drawn } = await frameOfFirst(view, () => dust.mock.calls.length > 0);
    expect(drawn[frame]).toBeLessThanOrEqual(1);
    expect(drawn[frame - 1]).toBeGreaterThan(1);
    expect(dust).toHaveBeenCalledTimes(1);
    const spawns = dust.mock.results[0].value as ReturnType<typeof landDust>;
    expect(spawns.filter((p) => p.shape !== 'soft')).toHaveLength(16 + 5 * 2);
    expect(spawns.filter((p) => p.shape === 'soft')).toHaveLength(3);
    // The dust spreads over 30n + 40 table points around the pile's centre, which sits midway
    // between the table's edges — nowhere near the felt's origin.
    const xs = spawns.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(100);
    expect(Math.min(...xs)).toBeGreaterThan(300);
    expect(Math.max(...xs)).toBeLessThan(560);
    await view.unmount();
  });
});
