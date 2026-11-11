// tests/native/fanGlossCadence.test.tsx — on web, an opponent's back drawn live through a glide re-poses its gloss at
// most 15 times a second (#1989, PR 6, option B), while the hand's gloss follows the lamp at its own steps; at rest the
// fan's baked track draws it and the backs' light is never written.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { FAN_GLOSS_FRAME_S, type GlossLight } from '@/components/table/cardGloss';
import type { Pool } from '@/components/table/lampRig';
import { NO_LANDING } from '@/components/table/useFlightClock';
import { useLampRig } from '@/components/table/useLampRig';
import { FRAME_MS } from './helpers/frames';
import { setMotion } from './harness/env';

let os: { restore(): void };
beforeEach(async () => {
  (globalThis as { document?: unknown }).document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  os = jest.replaceProperty(Platform, 'OS', 'web');
  jest.useFakeTimers();
  await setMotion('off');
});
afterEach(async () => {
  await setMotion('on');
  jest.useRealTimers();
  os.restore();
  delete (globalThis as { document?: unknown }).document;
});

const useRig = ({ pool }: { pool: Pool }) => useLampRig({ pool, deal: undefined, width: 874, height: 402, landing: useSharedValue(NO_LANDING) });

/** Steps `seconds` of 60 Hz frames, counting the frames each light was written on. */
async function watch(rig: ReturnType<typeof useRig>, seconds: number) {
  const lights = { fan: rig.tracks!.light, hand: rig.glossLight };
  const writes = { fan: 0, hand: 0 };
  const last: Record<keyof typeof lights, GlossLight> = { fan: lights.fan.value, hand: lights.hand.value };
  let live = 0;
  for (let n = 0; n < Math.round(seconds * 60); n++) {
    await act(async () => void jest.advanceTimersByTime(FRAME_MS));
    for (const k of ['fan', 'hand'] as const) {
      if (lights[k].value !== last[k]) writes[k]++;
      last[k] = lights[k].value;
    }
    if (rig.tracks!.live()) live++;
  }
  return { writes, live };
}

describe("an opponent's back drawn live on web", () => {
  it('re-poses its gloss at most 15 times a second through a glide, and not at all at rest', async () => {
    const view = await renderHook(useRig, { initialProps: { pool: [437, 180, 1] as Pool } });
    const rig = view.result.current;
    expect(rig.tracks).toBeDefined();

    await watch(rig, 3);
    const resting = await watch(rig, 1);
    expect(resting.live).toBe(0);
    expect(resting.writes.fan).toBe(0);

    await view.rerender({ pool: [120, 320, 1.4] });
    const glide = await watch(rig, 1);    expect(glide.live).toBe(60);
    expect(glide.writes.hand).toBeGreaterThan(40);
    expect(glide.writes.fan).toBeGreaterThanOrEqual(10);
    expect(glide.writes.fan).toBeLessThanOrEqual(Math.floor(1 / FAN_GLOSS_FRAME_S));
    expect(FAN_GLOSS_FRAME_S).toBeCloseTo(1 / 15, 9);
    await view.unmount();
  });
});
